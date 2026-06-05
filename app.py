from flask import Flask, request, jsonify, render_template
import pandas as pd
import subprocess
import platform
import socket
import os
import re
from datetime import datetime

app = Flask(__name__)

EXCEL_FILE = "usuarios.xlsx"
HISTORICO_FILE = "historico.xlsx"
MAX_HISTORICO = 3


# ── INICIALIZAÇÃO ─────────────────────────────────────────────────────────────

def init_excel():
    if not os.path.exists(EXCEL_FILE):
        df = pd.DataFrame(columns=["Nome", "RACF", "Hostname", "Funcional"])
        df.to_excel(EXCEL_FILE, index=False)

    if not os.path.exists(HISTORICO_FILE):
        df_h = pd.DataFrame(columns=["data_hora", "nome", "hostname", "ip", "status", "tempo_resposta"])
        df_h.to_excel(HISTORICO_FILE, index=False)


def load_df():
    return pd.read_excel(EXCEL_FILE, dtype=str).fillna("")


def load_historico():
    if not os.path.exists(HISTORICO_FILE):
        return pd.DataFrame(columns=["data_hora", "nome", "hostname", "ip", "status", "tempo_resposta"])
    df = pd.read_excel(HISTORICO_FILE, dtype=str).fillna("")
    return purgar_historico_expirado(df)


def purgar_historico_expirado(df):
    """
    Remove registros do histórico com mais de 10 minutos.
    Persiste o arquivo atualizado se houver remoções.
    """
    if df.empty:
        return df

    agora = datetime.now()
    expirados = []

    for idx, row in df.iterrows():
        try:
            data_registro = datetime.strptime(row["data_hora"], "%d/%m/%Y %H:%M:%S")
            if (agora - data_registro).total_seconds() > 600:
                expirados.append(idx)
        except (ValueError, TypeError):
            pass

    if expirados:
        df = df.drop(index=expirados).reset_index(drop=True)
        df.to_excel(HISTORICO_FILE, index=False)

    return df


# ── VALIDAÇÕES ────────────────────────────────────────────────────────────────

def validar_duplicatas(df, nome, racf, hostname, excluir_racf_original=None):
    df_check = df.copy()

    if excluir_racf_original:
        df_check = df_check[df_check["RACF"].str.strip().str.upper() != excluir_racf_original.upper()]

    if not df_check.empty:
        if df_check["RACF"].str.strip().str.upper().eq(racf.upper()).any():
            return "RACF_DUPLICADA", f"A RACF '{racf}' já está cadastrada. Cada RACF deve ser única."

        if df_check["Hostname"].str.strip().str.upper().eq(hostname.upper()).any():
            return "HOSTNAME_DUPLICADO", f"O Hostname '{hostname}' já está cadastrado para outro usuário."

    return None, None


# ── HELPER: PING INTERNO ──────────────────────────────────────────────────────

def _executar_ping(hostname):
    """
    Resolve o IP e executa ping. Retorna dict com ip, status, tempo_resposta, saida.
    Usado internamente por /ping e /reiniciar.
    """
    ip_resolvido = "Não resolvido"

    try:
        resultados = socket.getaddrinfo(hostname, None, socket.AF_INET)
        if resultados:
            ip_resolvido = resultados[0][4][0]
    except socket.gaierror:
        pass

    if ip_resolvido == "Não resolvido":
        try:
            nmb = subprocess.run(
                ["nmblookup", hostname],
                capture_output=True, text=True, timeout=5
            )
            match = re.search(r'(\d{1,3}(?:\.\d{1,3}){3})\s+' + re.escape(hostname), nmb.stdout, re.IGNORECASE)
            if match:
                ip_resolvido = match.group(1)
        except Exception:
            pass

    sistema = platform.system().lower()
    alvo_ping = ip_resolvido if ip_resolvido != "Não resolvido" else hostname

    if sistema == "windows":
        cmd = ["ping", "-n", "4", alvo_ping]
    else:
        cmd = ["ping", "-4", "-c", "4", "-W", "2", alvo_ping]

    status = "Offline"
    tempo_resposta = "—"
    saida = ""

    try:
        inicio = datetime.now()
        resultado = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        fim = datetime.now()

        saida = resultado.stdout or resultado.stderr or "(Sem saída)"

        if resultado.returncode == 0:
            status = "Online"
            ms = round((fim - inicio).total_seconds() * 1000 / 4)
            tempo_resposta = f"{ms} ms"

            rtt_match = re.search(r'[<=](\d+\.?\d*)\s*ms', saida)
            if rtt_match:
                tempo_resposta = f"{rtt_match.group(1)} ms"
        elif ip_resolvido == "Não resolvido":
            status = "Host não encontrado"

    except subprocess.TimeoutExpired:
        saida = f"ERRO: Timeout — '{hostname}' não respondeu em 30 segundos."
        status = "Offline"

    return {
        "ip": ip_resolvido,
        "status": status,
        "tempo_resposta": tempo_resposta,
        "saida": saida,
        "sucesso": status == "Online"
    }


# ── ROTAS CRUD ────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/cadastrar", methods=["POST"])
def cadastrar():
    data = request.json
    nome      = data.get("nome", "").strip()
    racf      = data.get("racf", "").strip()
    hostname  = data.get("hostname", "").strip()
    funcional = data.get("funcional", "").strip()

    if not nome or not racf or not hostname or not funcional:
        return jsonify({"erro": "Todos os campos são obrigatórios."}), 400

    if len(racf) > 7:
        return jsonify({"erro": "A RACF deve ter no máximo 7 caracteres.", "codigo": "RACF_TAMANHO"}), 400

    if not re.fullmatch(r'\d{1,9}', funcional):
        return jsonify({"erro": "O Funcional deve conter apenas números (máximo 9 dígitos).", "codigo": "FUNCIONAL_INVALIDO"}), 400

    df = load_df()
    campo_dup, msg_dup = validar_duplicatas(df, nome, racf, hostname)
    if campo_dup:
        return jsonify({"erro": msg_dup, "codigo": campo_dup}), 409

    nova_linha = pd.DataFrame([{"Nome": nome, "RACF": racf, "Hostname": hostname, "Funcional": funcional}])
    df = pd.concat([df, nova_linha], ignore_index=True)
    df.to_excel(EXCEL_FILE, index=False)

    return jsonify({"mensagem": "Usuário cadastrado com sucesso!"})


@app.route("/buscar", methods=["GET"])
def buscar():
    termo = request.args.get("q", "").strip().lower()
    if not termo:
        return jsonify([])

    df = load_df()
    mask = (
        df["Nome"].str.lower().str.contains(termo, na=False) |
        df["RACF"].str.lower().str.contains(termo, na=False) |
        df["Hostname"].str.lower().str.contains(termo, na=False)
    )
    resultado = df[mask].to_dict(orient="records")
    return jsonify(resultado)


@app.route("/editar", methods=["PUT"])
def editar():
    data = request.json
    racf_original = data.get("racf_original", "").strip()
    nome          = data.get("nome", "").strip()
    racf          = data.get("racf", "").strip()
    hostname      = data.get("hostname", "").strip()
    funcional     = data.get("funcional", "").strip()

    if not racf_original or not nome or not racf or not hostname or not funcional:
        return jsonify({"erro": "Todos os campos são obrigatórios."}), 400

    if len(racf) > 7:
        return jsonify({"erro": "A RACF deve ter no máximo 7 caracteres.", "codigo": "RACF_TAMANHO"}), 400

    if not re.fullmatch(r'\d{1,9}', funcional):
        return jsonify({"erro": "O Funcional deve conter apenas números (máximo 9 dígitos).", "codigo": "FUNCIONAL_INVALIDO"}), 400

    df = load_df()
    idx = df.index[df["RACF"].str.strip() == racf_original].tolist()

    if not idx:
        return jsonify({"erro": "Usuário não encontrado."}), 404

    campo_dup, msg_dup = validar_duplicatas(df, nome, racf, hostname, excluir_racf_original=racf_original)
    if campo_dup:
        return jsonify({"erro": msg_dup, "codigo": campo_dup}), 409

    df.at[idx[0], "Nome"]      = nome
    df.at[idx[0], "RACF"]      = racf
    df.at[idx[0], "Hostname"]  = hostname
    df.at[idx[0], "Funcional"] = funcional
    df.to_excel(EXCEL_FILE, index=False)

    return jsonify({"mensagem": "Usuário atualizado com sucesso!"})


@app.route("/excluir", methods=["DELETE"])
def excluir():
    racf = request.args.get("racf", "").strip()

    if not racf:
        return jsonify({"erro": "RACF não informado."}), 400

    df = load_df()
    idx = df.index[df["RACF"].str.strip() == racf].tolist()

    if not idx:
        return jsonify({"erro": "Usuário não encontrado."}), 404

    df = df.drop(index=idx[0]).reset_index(drop=True)
    df.to_excel(EXCEL_FILE, index=False)

    return jsonify({"mensagem": "Usuário excluído com sucesso!"})


# ── ROTA: PING ────────────────────────────────────────────────────────────────

@app.route("/ping", methods=["POST"])
def ping():
    data = request.json
    hostname = data.get("hostname", "").strip()
    nome = data.get("nome", "").strip()

    if not hostname:
        return jsonify({"erro": "Hostname não informado."}), 400

    if not re.match(r'^[a-zA-Z0-9.\-_]+$', hostname):
        return jsonify({"erro": "Hostname inválido. Caracteres não permitidos."}), 400

    try:
        resultado = _executar_ping(hostname)
    except FileNotFoundError:
        return jsonify({"erro": "Comando 'ping' não encontrado no servidor."}), 500
    except Exception as e:
        return jsonify({"erro": f"Erro inesperado: {str(e)}"}), 500

    # Salvar no histórico
    df_h = load_historico()
    novo_reg = pd.DataFrame([{
        "data_hora": datetime.now().strftime("%d/%m/%Y %H:%M:%S"),
        "nome": nome or hostname,
        "hostname": hostname,
        "ip": resultado["ip"],
        "status": resultado["status"],
        "tempo_resposta": resultado["tempo_resposta"]
    }])
    df_h = pd.concat([novo_reg, df_h], ignore_index=True).head(MAX_HISTORICO)
    df_h.to_excel(HISTORICO_FILE, index=False)

    return jsonify({
        "hostname": hostname,
        "ip": resultado["ip"],
        "status": resultado["status"],
        "tempo_resposta": resultado["tempo_resposta"],
        "saida": resultado["saida"],
        "sucesso": resultado["sucesso"],
        "sistema": platform.system()
    })


# ── ROTA: GERAR COMANDO DE REINICIALIZAÇÃO ────────────────────────────────────

@app.route("/gerar-comando", methods=["POST"])
def gerar_comando():
    """
    Resolve o IP do equipamento via ping e retorna o comando de
    reinicialização pronto para copiar/colar, sem executá-lo.

    Resposta JSON:
      ip           – IP resolvido (ou hostname se não resolvido)
      status_ping  – Online / Offline / Host não encontrado
      comando      – Comando de reinicialização montado
      sistema_alvo – 'windows' | 'linux'
    """
    data = request.json
    hostname = data.get("hostname", "").strip()

    if not hostname:
        return jsonify({"erro": "Hostname não informado."}), 400

    if not re.match(r'^[a-zA-Z0-9.\-_]+$', hostname):
        return jsonify({"erro": "Hostname inválido. Caracteres não permitidos."}), 400

    # ── Passo 1: resolver IP ──────────────────────────────────────────────────
    try:
        ping_resultado = _executar_ping(hostname)
    except FileNotFoundError:
        return jsonify({"erro": "Comando 'ping' não encontrado no servidor."}), 500
    except Exception as e:
        return jsonify({"erro": f"Erro inesperado: {str(e)}"}), 500

    ip = ping_resultado["ip"]
    alvo = ip if ip != "Não resolvido" else hostname

    # ── Passo 2: montar comando de reinicialização ────────────────────────────
    comando = f"shutdown /r /f /t 0 /m \\\\{alvo}"

    return jsonify({
        "ip": ip,
        "status_ping": ping_resultado["status"],
        "sucesso_ping": ping_resultado["sucesso"],
        "comando": comando
    })


# ── ROTA: HISTÓRICO ───────────────────────────────────────────────────────────

@app.route("/historico", methods=["GET"])
def historico():
    df_h = load_historico()
    registros = df_h.head(MAX_HISTORICO).to_dict(orient="records")
    return jsonify(registros)


if __name__ == "__main__":
    init_excel()
    app.run(debug=True)

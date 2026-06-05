# Network Sentinel — Cadastro e Consulta de Hosts

Aplicação web com Flask + Pandas que usa arquivos Excel como banco de dados para gerenciamento de usuários de rede, com suporte a resolução de IP, execução de ping, reinicialização remota de equipamentos e histórico automático de consultas.

---

## 📁 Estrutura do Projeto

```
network-sentinel/
├── app.py                  ← Backend Flask (rotas, validações, lógica de negócio)
├── requirements.txt        ← Dependências Python
├── usuarios.xlsx           ← Gerado automaticamente ao rodar
├── historico.xlsx          ← Gerado automaticamente ao rodar
├── templates/
│   └── index.html          ← Estrutura HTML da interface
└── static/
    ├── css/
    │   └── style.css       ← Estilos visuais (Design System + Dark Mode)
    └── js/
        └── app.js          ← Lógica JavaScript do frontend
```

---

## ⚙️ Pré-requisitos

- Python 3.8 ou superior
- pip

---

## 🚀 Como Rodar

### 1. Clone ou baixe os arquivos do projeto

Mantenha a estrutura de pastas exatamente como descrita acima.

### 2. Crie um ambiente virtual (recomendado)

```bash
cd network-sentinel
python -m venv venv
```

Ative o ambiente virtual:

- **Windows:**
  ```bash
  venv\Scripts\activate
  ```
- **macOS/Linux:**
  ```bash
  source venv/bin/activate
  ```

### 3. Instale as dependências

```bash
pip install -r requirements.txt
```

### 4. Rode a aplicação

```bash
python app.py
```

### 5. Acesse no navegador

Abra: [http://localhost:5000](http://localhost:5000)

---

## 📌 Rotas da API

| Rota          | Método   | Descrição                                          |
|---------------|----------|----------------------------------------------------|
| `/`           | `GET`    | Página principal                                   |
| `/cadastrar`  | `POST`   | Cadastra novo usuário                              |
| `/buscar`     | `GET`    | Busca por Nome, RACF ou Hostname                   |
| `/editar`     | `PUT`    | Edita registro existente                           |
| `/excluir`    | `DELETE` | Remove usuário por RACF                            |
| `/ping`       | `POST`   | Executa ping e registra no histórico               |
| `/reiniciar`  | `POST`   | Verifica conectividade e reinicia o equipamento    |
| `/historico`  | `GET`    | Retorna os pings válidos (não expirados)           |

---

## 🌙 Dark Mode

O botão de alternância de tema (☀️/🌙) está disponível na barra de navegação superior (topnav), ao lado do avatar.

- Alterna entre modo **claro** e **escuro** com um clique.
- A preferência é salva no `localStorage` com a chave `ns_theme`.
- O tema é aplicado antes do primeiro paint (via IIFE no `app.js`) para evitar flash de conteúdo não estilizado.

---

## ⚡ Reinicialização de Equipamento

Cada card de host na aba **Hosts** possui o botão **⚡ Reiniciar**, que executa o seguinte fluxo:

1. **Verificando conectividade** — realiza ping ao equipamento usando a mesma lógica da rota `/ping`.
2. **Equipamento online** — confirmado que o host responde.
3. **Reiniciando equipamento** — envia o comando de reinicialização remota.
4. **Falha na comunicação** — exibida caso o ping não obtenha resposta.

### Estratégia de reinício por sistema operacional

| Sistema detectado          | Comando enviado                                      |
|----------------------------|------------------------------------------------------|
| Servidor Flask no Windows  | `shutdown /r /m \\<host> /t 0 /f`                   |
| Host Windows (DESKTOP-/WIN-)| `net rpc shutdown -I <ip> -t 0 -f --no-pass`        |
| Host Linux                 | `ssh -o BatchMode=yes <ip> sudo shutdown -r now`     |

> **Nota:** A reinicialização remota real requer credenciais ou configuração de SSH sem senha / acesso Samba. Em ambientes restritos o comando será emitido mas pode retornar erro de autenticação (reportado na tela).

---

## 🗂️ Modelo de Dados

### `usuarios.xlsx` — Cadastro de usuários

| Coluna      | Tipo   | Descrição                          |
|-------------|--------|------------------------------------|
| `Nome`      | Texto  | Nome completo do usuário           |
| `RACF`      | Texto  | Identificador único (máx. 7 chars) |
| `Funcional` | Texto  | Código numérico (máx. 9 dígitos)   |
| `Hostname`  | Texto  | Hostname único da máquina          |

### `historico.xlsx` — Histórico de pings

| Coluna           | Tipo   | Descrição                                    |
|------------------|--------|----------------------------------------------|
| `data_hora`      | Texto  | Data/hora no formato DD/MM/YYYY HH:MM:SS     |
| `nome`           | Texto  | Nome do usuário ou hostname                  |
| `hostname`       | Texto  | Hostname consultado                          |
| `ip`             | Texto  | IP resolvido                                 |
| `status`         | Texto  | Online / Offline / Host não encontrado       |
| `tempo_resposta` | Texto  | Latência medida (ex: `12 ms`)                |

---

## 🔒 Regras de Validação

### Campo RACF
- **Obrigatório** em cadastro e edição.
- **Máximo de 7 caracteres**.
- **Único** — validação case-insensitive.

### Campo Funcional
- **Obrigatório** em cadastro e edição.
- **Apenas números**, máximo de 9 dígitos.

### Campo Hostname
- **Obrigatório** em cadastro e edição.
- **Único** — validação case-insensitive.
- Na rota `/ping` e `/reiniciar`, passa por validação de caracteres permitidos (`^[a-zA-Z0-9.\-_]+$`).

---

## 🕐 Expiração Automática do Histórico

Registros com **mais de 10 minutos** são removidos automaticamente do `historico.xlsx` a cada consulta ou novo ping.

---

## 📝 Observações

- Para produção, remova `debug=True` em `app.py` e considere um servidor WSGI como Gunicorn.
- A busca é **case-insensitive** e suporta correspondência parcial nos campos Nome, RACF e Hostname.
- A reinicialização remota pode exigir configuração adicional de rede/autenticação dependendo do ambiente.

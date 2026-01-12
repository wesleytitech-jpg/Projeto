document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('localSearch');
    const cards = document.querySelectorAll('.item-manual');
    const noResults = document.getElementById('noResultsMessage');

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase().trim();
            let hasFound = false;

            cards.forEach(card => {
                const title = card.querySelector('h2').innerText.toLowerCase();
                const description = card.querySelector('p').innerText.toLowerCase();

                if (title.includes(searchTerm) || description.includes(searchTerm)) {
                    card.style.display = ""; 
                    hasFound = true;
                } else {
                    card.style.display = "none";
                }
            });

            noResults.style.display = hasFound ? "none" : "block";
        });
    }
});
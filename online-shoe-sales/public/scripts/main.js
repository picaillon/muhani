document.addEventListener('DOMContentLoaded', function() {
    // Navigation
    const sections = {
        home: document.getElementById('home-section'),
        products: document.getElementById('products-section'),
        cart: document.getElementById('cart-section'),
        contact: document.getElementById('contact-section')
    };
    function showSection(page) {
        Object.entries(sections).forEach(([key, sec]) => {
            sec.style.display = (key === page) ? '' : 'none';
        });
        document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
        document.querySelectorAll('.nav-link[data-page="'+page+'"]').forEach(l => l.classList.add('active'));
    }
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const page = link.getAttribute('data-page');
            if (page) showSection(page);
        });
    });

    // Panier
    let cart = [];
    const cartCountSpan = document.getElementById('cart-count');
    function updateCart() {
        const cartItems = document.getElementById('cart-items');
        const cartTotal = document.getElementById('cart-total');
        const checkoutBtn = document.getElementById('checkout-btn');
        cartItems.innerHTML = '';
        if (cart.length === 0) {
            cartItems.textContent = "Votre panier est vide.";
            cartTotal.textContent = '';
            checkoutBtn.style.display = 'none';
            document.getElementById('order-form').style.display = 'none';
            return;
        }
        cart.forEach((item, idx) => {
            const div = document.createElement('div');
            div.className = "cart-item";
            div.innerHTML = `
                <img src="${item.img}" alt="${item.name}">
                <div class="cart-item-details">
                    <span style="font-weight:600;">${item.name}</span>
                    <span>${item.price.toFixed(2)} $</span>
                </div>
                <button data-idx="${idx}" class="cart-item-remove">Retirer</button>
            `;
            cartItems.appendChild(div);
        });
        cartTotal.textContent = "Total : " + cart.reduce((sum, i) => sum + i.price, 0).toFixed(2) + " $";
        checkoutBtn.style.display = '';
        document.querySelectorAll('.cart-item-remove').forEach(btn => {
            btn.onclick = function() {
                cart.splice(btn.getAttribute('data-idx'), 1);
                cartCountSpan.textContent = cart.length;
                updateCart();
            };
        });
    }
    document.querySelectorAll('.add-cart').forEach(btn => {
        btn.addEventListener('click', function() {
            const card = btn.closest('.card');
            const name = card.getAttribute('data-name');
            const price = parseFloat(card.getAttribute('data-price'));
            const img = card.getAttribute('data-img');
            cart.push({name, price, img});
            cartCountSpan.textContent = cart.length;
            updateCart();
            showSection('cart');
        });
    });

    // Commander
    document.getElementById('checkout-btn').onclick = function() {
        document.getElementById('order-form').style.display = '';
        document.getElementById('order-success').style.display = 'none';
    };
    document.getElementById('order-form').onsubmit = function(e) {
        e.preventDefault();
        // Récupère les infos
        const name = this.name.value;
        const email = this.email.value;
        const address = this.address.value;
        let message = `Nouvelle commande:%0A`;
        message += `Nom: ${name}%0A`;
        message += `Email: ${email}%0A`;
        message += `Adresse: ${address}%0AProduits:%0A`;
        cart.forEach(item => {
            message += `- ${item.name} (${item.price.toFixed(2)} €)%0A`;
        });
        message += `Total: ${cart.reduce((sum, i) => sum + i.price, 0).toFixed(2)} €`;
        // Génère le lien WhatsApp
        const whatsappUrl = `https://wa.me/243974586076?text=${message}`;
        const whatsappBtn = document.getElementById('whatsapp-btn');
        whatsappBtn.href = whatsappUrl;
        whatsappBtn.style.display = 'inline-block';
        document.getElementById('order-success').style.display = '';
        // Vide le panier
        cart = [];
        cartCountSpan.textContent = 0;
        updateCart();
        this.style.display = 'none';
        setTimeout(() => {
            document.getElementById('order-success').style.display = 'none';
        }, 2500);
    };
    document.getElementById('whatsapp-order-btn').onclick = function() {
        const form = document.getElementById('order-form');
        const name = form.name.value;
        const email = form.email.value;
        const address = form.address.value;
        let message = `Nouvelle commande:%0A`;
        message += `Nom: ${name}%0A`;
        message += `Email: ${email}%0A`;
        message += `Adresse: ${address}%0AProduits:%0A`;
        const products = getProducts();
        cart.forEach(item => {
            message += `- ${item.name} (${item.price.toFixed(2)} $)%0A`;
            if (typeof item.idx !== "undefined" && products[item.idx].stock > 0) {
                products[item.idx].stock -= 1;
            }
        });
        saveProducts(products);
        renderProducts();
        message += `Total: ${cart.reduce((sum, i) => sum + i.price, 0).toFixed(2)} $`;
        const whatsappUrl = `https://wa.me/243974586076?text=${message}`;
        window.open(whatsappUrl, '_blank');
        cart = [];
        cartCountSpan.textContent = 0;
        updateCart();
        form.style.display = 'none';
        document.getElementById('order-success').style.display = '';
        setTimeout(() => {
            document.getElementById('order-success').style.display = 'none';
        }, 2500);
    };

    // Contact
    document.getElementById('contact-form').onsubmit = function(e) {
        e.preventDefault();
        document.getElementById('contact-success').style.display = '';
        setTimeout(() => {
            document.getElementById('contact-success').style.display = 'none';
            document.getElementById('contact-form').reset();
        }, 2000);
    };

    // Auth JS
    const authModal = document.getElementById('auth-modal');
    const loginBox = document.getElementById('auth-box-login');
    const registerBox = document.getElementById('auth-box-register');
    const showRegister = document.getElementById('show-register');
    const showLogin = document.getElementById('show-login');
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const authErrorLogin = document.getElementById('auth-error-login');
    const authErrorRegister = document.getElementById('auth-error-register');
    const addProductForm = document.getElementById('add-product-form');
    const adminActions = document.getElementById('admin-actions');
    const showAddProductFormBtn = document.getElementById('show-add-product-form');
    const logoutBtn = document.getElementById('logout-btn');

    // Stockage des comptes (localStorage)
    function getAccounts() {
        const acc = localStorage.getItem('accounts');
        return acc ? JSON.parse(acc) : [];
    }
    function saveAccount(username, password) {
        const accounts = getAccounts();
        accounts.push({username, password});
        localStorage.setItem('accounts', JSON.stringify(accounts));
    }
    function checkAccount(username, password) {
        if(username === "muhani" && password === "muhani") return "admin";
        const accounts = getAccounts();
        return accounts.some(acc => acc.username === username && acc.password === password) ? "user" : null;
    }

    // Switch login/register
    showRegister.onclick = () => {
        loginBox.style.display = "none";
        registerBox.style.display = "";
        authErrorLogin.style.display = "none";
        authErrorRegister.style.display = "none";
    };
    showLogin.onclick = () => {
        loginBox.style.display = "";
        registerBox.style.display = "none";
        authErrorLogin.style.display = "none";
        authErrorRegister.style.display = "none";
    };

    // Login
    loginForm.onsubmit = function(e) {
        e.preventDefault();
        const username = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value.trim();
        const role = checkAccount(username, password);
        if(role === "admin") {
            localStorage.setItem('currentRole', 'admin');
            authModal.style.display = "none";
            adminActions.style.display = "";
            logoutBtn.style.display = "";
            addProductForm.style.display = "none";
            renderProducts();
        } else if(role === "user") {
            localStorage.setItem('currentRole', 'user');
            authModal.style.display = "none";
            adminActions.style.display = "none";
            logoutBtn.style.display = "";
            addProductForm.style.display = "none";
            renderProducts();
        } else {
            authErrorLogin.textContent = "Nom d'utilisateur ou mot de passe incorrect.";
            authErrorLogin.style.display = "";
        }
    };

    // Register
    registerForm.onsubmit = function(e) {
        e.preventDefault();
        const username = document.getElementById('register-username').value.trim();
        const password = document.getElementById('register-password').value.trim();
        if(username === "" || password === "") {
            authErrorRegister.textContent = "Veuillez remplir tous les champs.";
            authErrorRegister.style.display = "";
            return;
        }
        if(username === "muhani") {
            authErrorRegister.textContent = "Ce nom d'utilisateur est réservé à l'administrateur.";
            authErrorRegister.style.display = "";
            return;
        }
        const accounts = getAccounts();
        if(accounts.some(acc => acc.username === username)) {
            authErrorRegister.textContent = "Ce nom d'utilisateur existe déjà.";
            authErrorRegister.style.display = "";
            return;
        }
        saveAccount(username, password);
        authErrorRegister.textContent = "Inscription réussie ! Connectez-vous.";
        authErrorRegister.style.color = "green";
        authErrorRegister.style.display = "";
        setTimeout(() => {
            showLogin.onclick();
            authErrorRegister.style.color = "red";
        }, 1200);
    };

    // Déconnexion
    if (logoutBtn) {
        logoutBtn.onclick = function() {
            localStorage.removeItem('currentRole');
            location.reload();
        };
    }

    // Gestion des produits avec localStorage
    function getProducts() {
        const saved = localStorage.getItem('products');
        if (saved) return JSON.parse(saved);
        return [
            {
                name: "Basket Moderne",
                oldPrice: 69.99,
                price: 59.99,
                stock: 5,
                color: "Noir",
                number: "42",
                img: "https://images.unsplash.com/photo-1517263904808-5dc0d6e1b8a8?auto=format&fit=crop&w=400&q=80"
            },
            {
                name: "Chaussure Classique",
                oldPrice: 89.99,
                price: 79.99,
                stock: 3,
                color: "Blanc",
                number: "40",
                img: "https://images.unsplash.com/photo-1528701800484-905909b7c7b0?auto=format&fit=crop&w=400&q=80"
            }
        ];
    }
    function saveProducts(products) {
        localStorage.setItem('products', JSON.stringify(products));
    }
    function renderProducts() {
        const products = getProducts();
        const list = document.getElementById('products-list');
        list.innerHTML = '';
        const role = localStorage.getItem('currentRole');
        products.forEach((prod, idx) => {
            const available = prod.stock > 0;
            const status = available
                ? `<span style="color:green;font-weight:bold;position:absolute;top:12px;right:18px;">Disponible</span>`
                : `<span style="color:red;font-weight:bold;position:absolute;top:12px;right:18px;">Non disponible</span>`;
            const card = document.createElement('div');
            card.className = 'card';
            card.setAttribute('data-name', prod.name);
            card.setAttribute('data-price', prod.price);
            card.setAttribute('data-img', prod.img);
            card.setAttribute('data-idx', idx);
            card.innerHTML = `
    <div class="card-header">
        <span class="product-status ${available ? 'available' : 'unavailable'}">
            ${available ? 'Disponible' : 'Non disponible'}
        </span>
    </div>
    <img src="${prod.img}" alt="${prod.name}">
    <h3>${prod.name}</h3>
    <span class="old-price">${prod.oldPrice ? Math.floor(prod.oldPrice) + ' $' : ''}</span>
    <span class="price">${Math.floor(prod.price)} $</span>
    <div style="margin:0.5rem 0;">
        <span style="font-size:0.98rem;color:#555;">Stock: ${prod.stock}</span><br>
        <span style="font-size:0.98rem;color:#555;">Couleur: ${prod.color}</span><br>
        <span style="font-size:0.98rem;color:#555;">Numéro: ${prod.number}</span>
    </div>
    <button class="add-cart" ${!available ? 'disabled style="background:#ccc;color:#fff;cursor:not-allowed;"' : ''}>Ajouter au panier</button>
    ${role === 'admin' ? `

        <button class="delete-product" data-idx="${idx}" style="background:#ff2222;color:#fff;margin-top:8px;border:none;border-radius:15px;padding:0.3rem 1rem;cursor:pointer;">Supprimer</button>
        <button class="add-stock" data-idx="${idx}" style="background:#25d366;color:#fff;margin-top:8px;border:none;border-radius:15px;padding:0.3rem 1rem;cursor:pointer;">Ajouter au stock</button>
    ` : ''}
`;
            list.appendChild(card);
        });
        // Ajout au panier
        document.querySelectorAll('.add-cart').forEach(btn => {
            btn.onclick = function() {
                const card = btn.closest('.card');
                const idx = parseInt(card.getAttribute('data-idx'));
                const products = getProducts();
                if (products[idx].stock > 0) {
                    const name = products[idx].name;
                    const price = products[idx].price;
                    const img = products[idx].img;
                    cart.push({name, price, img});
                    cartCountSpan.textContent = cart.length;
                    products[idx].stock -= 1;
                    saveProducts(products);
                    renderProducts();
                    updateCart();
                    showSection('cart');
                }
            };
        });
        // Suppression produit (admin)
        if (role === 'admin') {
            document.querySelectorAll('.delete-product').forEach(btn => {
                btn.onclick = function() {
                    const idx = parseInt(btn.getAttribute('data-idx'));
                    const products = getProducts();
                    products.splice(idx, 1);
                    saveProducts(products);
                    renderProducts();
                };
            });
            document.querySelectorAll('.add-stock').forEach(btn => {
                btn.onclick = function() {
                    const idx = parseInt(btn.getAttribute('data-idx'));
                    const products = getProducts();
                    products[idx].stock = (products[idx].stock || 0) + 1;
                    saveProducts(products);
                    renderProducts();
                };
            });
        }
    }

    // Ajout de produit (admin)
    if (addProductForm) {
        addProductForm.onsubmit = function(e) {
            e.preventDefault();
            const name = document.getElementById('product-name').value;
            const oldPrice = parseFloat(document.getElementById('product-old-price').value);
            const price = parseFloat(document.getElementById('product-price').value);
            const stock = parseInt(document.getElementById('product-stock').value);
            const color = document.getElementById('product-color').value;
            const number = document.getElementById('product-number').value;
            const imgInput = document.getElementById('product-img');
            const file = imgInput.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function(evt) {
                const imgData = evt.target.result;
                const products = getProducts();
                products.push({name, oldPrice, price, stock, color, number, img: imgData});
                saveProducts(products);
                renderProducts();
                addProductForm.reset();
            };
            reader.readAsDataURL(file);
        };
    }

    // Bouton pour afficher le formulaire d'ajout (admin uniquement)
    if (showAddProductFormBtn) {
        showAddProductFormBtn.onclick = function() {
            if(localStorage.getItem('currentRole') === 'admin') {
                addProductForm.style.display = addProductForm.style.display === 'none' ? '' : 'none';
            }
        };
    }

    // Affiche Accueil au chargement
    showSection('home');
    // Affiche les produits au chargement de la page produits
    document.addEventListener('DOMContentLoaded', function() {
        renderProducts();
    });

    const text = "Découvrez les dernières tendances";
    const target = document.getElementById('animated-title');
    let i = 0;
    function animate() {
        if (target) {
            target.textContent = text.slice(0, i);
            i++;
            if (i <= text.length) setTimeout(animate, 60);
        }
    }
    animate();
});

// Visualiser le mot de passe
document.querySelectorAll('input[type="password"]').forEach(function(input){
    const toggle = document.createElement('span');
    toggle.textContent = '👁️';
    toggle.style.cursor = 'pointer';
    toggle.style.marginLeft = '8px';
    toggle.onclick = function() {
        input.type = input.type === 'password' ? 'text' : 'password';
    };
    input.parentNode.appendChild(toggle);
});


import React from 'react';

interface Shoe {
    id: number;
    name: string;
    price: number;
    imageUrl: string;
    description: string;
}

interface ShoeCardProps {
    shoe: Shoe;
    onAddToCart: (shoe: Shoe) => void;
}

const ShoeCard: React.FC<ShoeCardProps> = ({ shoe, onAddToCart }) => {
    return (
        <div className="shoe-card">
            <img src={shoe.imageUrl} alt={shoe.name} className="shoe-image" />
            <h3 className="shoe-name">{shoe.name}</h3>
            <p className="shoe-description">{shoe.description}</p>
            <p className="shoe-price">${shoe.price.toFixed(2)}</p>
            <button onClick={() => onAddToCart(shoe)} className="add-to-cart-button">
                Add to Cart
            </button>
        </div>
    );
};

export default ShoeCard;
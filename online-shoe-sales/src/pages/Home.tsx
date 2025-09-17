import React from 'react';
import ShoeCard from '../components/ShoeCard';

const shoes = [
    {
        id: 1,
        name: 'Running Shoe',
        image: '/assets/running-shoe.jpg',
        price: 59.99,
        description: 'Lightweight and comfortable running shoe.'
    },
    {
        id: 2,
        name: 'Basketball Shoe',
        image: '/assets/basketball-shoe.jpg',
        price: 89.99,
        description: 'High-performance basketball shoe for the court.'
    },
    {
        id: 3,
        name: 'Casual Sneaker',
        image: '/assets/casual-sneaker.jpg',
        price: 49.99,
        description: 'Stylish and versatile casual sneaker.'
    }
];

const Home: React.FC = () => {
    return (
        <div className="home">
            <h1>Welcome to Our Online Shoe Store</h1>
            <div className="shoe-list">
                {shoes.map(shoe => (
                    <ShoeCard key={shoe.id} shoe={shoe} />
                ))}
            </div>
        </div>
    );
};

export default Home;
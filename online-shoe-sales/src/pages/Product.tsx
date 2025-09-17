import React from 'react';
import { useParams } from 'react-router-dom';
import ShoeCard from '../components/ShoeCard';
import { Shoe } from '../types';

const Product: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const [shoe, setShoe] = React.useState<Shoe | null>(null);

    React.useEffect(() => {
        const fetchShoe = async () => {
            const response = await fetch(`/api/shoes/${id}`);
            const data = await response.json();
            setShoe(data);
        };

        fetchShoe();
    }, [id]);

    if (!shoe) {
        return <div>Loading...</div>;
    }

    return (
        <div className="product-page">
            <ShoeCard shoe={shoe} />
            <button>Add to Cart</button>
        </div>
    );
};

export default Product;
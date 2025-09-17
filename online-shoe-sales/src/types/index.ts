export interface Shoe {
    id: string;
    name: string;
    brand: string;
    size: number;
    price: number;
    imageUrl: string;
    description: string;
}

export interface CartItem {
    shoe: Shoe;
    quantity: number;
}
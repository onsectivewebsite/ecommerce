import React from 'react';
import type { CartDto } from '@onsective/shared-types';
import { api } from './api';
import { useAuth } from './auth-context';

interface CartValue {
  cart: CartDto | null;
  loading: boolean;
  reload(): Promise<void>;
  addItem(variantId: string, qty: number): Promise<void>;
  updateItem(itemId: string, qty: number): Promise<void>;
  removeItem(itemId: string): Promise<void>;
}

const CartContext = React.createContext<CartValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [cart, setCart] = React.useState<CartDto | null>(null);
  const [loading, setLoading] = React.useState(true);

  const reload = React.useCallback(async () => {
    if (!user) { setCart(null); setLoading(false); return; }
    setLoading(true);
    try { setCart(await api.cart.get()); }
    catch { setCart(null); }
    finally { setLoading(false); }
  }, [user]);

  React.useEffect(() => { reload(); }, [reload]);

  const addItem = React.useCallback(async (variantId: string, qty: number) => {
    const next = await api.cart.addItem({ variantId, qty });
    setCart(next);
  }, []);

  const updateItem = React.useCallback(async (itemId: string, qty: number) => {
    const next = await api.cart.updateItem(itemId, { qty });
    setCart(next);
  }, []);

  const removeItem = React.useCallback(async (itemId: string) => {
    const next = await api.cart.removeItem(itemId);
    setCart(next);
  }, []);

  return (
    <CartContext.Provider value={{ cart, loading, reload, addItem, updateItem, removeItem }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartValue {
  const ctx = React.useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within <CartProvider>');
  return ctx;
}

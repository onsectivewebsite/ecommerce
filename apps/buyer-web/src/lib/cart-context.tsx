'use client';

import * as React from 'react';
import type { CartDto } from '@onsective/shared-types';
import { api } from './api';
import { useAuth } from './auth-context';

interface CartContextValue {
  cart: CartDto | null;
  loading: boolean;
  refresh(): Promise<void>;
  addItem(variantId: string, qty: number): Promise<void>;
  updateItem(itemId: string, qty: number): Promise<void>;
  removeItem(itemId: string): Promise<void>;
}

const CartContext = React.createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [cart, setCart] = React.useState<CartDto | null>(null);
  const [loading, setLoading] = React.useState(false);

  const refresh = React.useCallback(async () => {
    if (!user) {
      setCart(null);
      return;
    }
    setLoading(true);
    try {
      const c = await api.cart.get();
      setCart(c);
    } finally {
      setLoading(false);
    }
  }, [user]);

  React.useEffect(() => {
    if (!authLoading) refresh();
  }, [authLoading, refresh]);

  const value: CartContextValue = {
    cart,
    loading,
    refresh,
    addItem: async (variantId, qty) => setCart(await api.cart.addItem({ variantId, qty })),
    updateItem: async (itemId, qty) => setCart(await api.cart.updateItem(itemId, { qty })),
    removeItem: async (itemId) => setCart(await api.cart.removeItem(itemId)),
  };
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = React.useContext(CartContext);
  if (!ctx) throw new Error('useCart must be inside CartProvider');
  return ctx;
}

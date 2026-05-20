import type { NavigatorScreenParams } from '@react-navigation/native';

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
};

export type HomeStackParamList = {
  Home: undefined;
  Search: { q?: string } | undefined;
  Product: { slug: string };
};

export type CartStackParamList = {
  Cart: undefined;
  Checkout: undefined;
  OrderConfirm: { orderId: string };
};

export type OrdersStackParamList = {
  Orders: undefined;
  Order: { orderId: string };
};

export type AccountStackParamList = {
  Account: undefined;
};

export type MainTabParamList = {
  HomeTab: NavigatorScreenParams<HomeStackParamList>;
  CartTab: NavigatorScreenParams<CartStackParamList>;
  OrdersTab: NavigatorScreenParams<OrdersStackParamList>;
  AccountTab: NavigatorScreenParams<AccountStackParamList>;
};

export type RootStackParamList = {
  Onboarding: undefined;
  Auth: NavigatorScreenParams<AuthStackParamList>;
  Main: NavigatorScreenParams<MainTabParamList>;
};

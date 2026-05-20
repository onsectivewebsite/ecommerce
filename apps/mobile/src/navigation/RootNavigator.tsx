import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';
import { useAuth } from '../lib/auth-context';
import { colors } from '../lib/theme';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { RegisterScreen } from '../screens/RegisterScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { SearchScreen } from '../screens/SearchScreen';
import { ProductScreen } from '../screens/ProductScreen';
import { CartScreen } from '../screens/CartScreen';
import { CheckoutScreen } from '../screens/CheckoutScreen';
import { OrderConfirmScreen } from '../screens/OrderConfirmScreen';
import { OrdersScreen } from '../screens/OrdersScreen';
import { OrderScreen } from '../screens/OrderScreen';
import { AccountScreen } from '../screens/AccountScreen';
import type {
  AuthStackParamList,
  CartStackParamList,
  HomeStackParamList,
  MainTabParamList,
  OrdersStackParamList,
  AccountStackParamList,
  RootStackParamList,
} from './types';

const RootStack = createNativeStackNavigator<RootStackParamList>();
const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const HomeStack = createNativeStackNavigator<HomeStackParamList>();
const CartStack = createNativeStackNavigator<CartStackParamList>();
const OrdersStack = createNativeStackNavigator<OrdersStackParamList>();
const AccountStack = createNativeStackNavigator<AccountStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

const stackOpts = {
  headerStyle: { backgroundColor: colors.ink[950] },
  headerTitleStyle: { color: colors.ink[50] },
  headerTintColor: colors.ink[50],
  contentStyle: { backgroundColor: colors.ink[950] },
};

function AuthNav() {
  return (
    <AuthStack.Navigator screenOptions={stackOpts}>
      <AuthStack.Screen name="Login" component={LoginScreen} options={{ title: 'Sign in' }} />
      <AuthStack.Screen name="Register" component={RegisterScreen} options={{ title: 'Create account' }} />
    </AuthStack.Navigator>
  );
}

function HomeNav() {
  return (
    <HomeStack.Navigator screenOptions={stackOpts}>
      <HomeStack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
      <HomeStack.Screen name="Search" component={SearchScreen} options={{ title: 'Search' }} />
      <HomeStack.Screen name="Product" component={ProductScreen} options={{ title: '' }} />
    </HomeStack.Navigator>
  );
}

function CartNav() {
  return (
    <CartStack.Navigator screenOptions={stackOpts}>
      <CartStack.Screen name="Cart" component={CartScreen} options={{ title: 'Cart' }} />
      <CartStack.Screen name="Checkout" component={CheckoutScreen} options={{ title: 'Checkout' }} />
      <CartStack.Screen name="OrderConfirm" component={OrderConfirmScreen} options={{ title: 'Thanks' }} />
    </CartStack.Navigator>
  );
}

function OrdersNav() {
  return (
    <OrdersStack.Navigator screenOptions={stackOpts}>
      <OrdersStack.Screen name="Orders" component={OrdersScreen} options={{ title: 'Orders' }} />
      <OrdersStack.Screen name="Order" component={OrderScreen} options={{ title: 'Order' }} />
    </OrdersStack.Navigator>
  );
}

function AccountNav() {
  return (
    <AccountStack.Navigator screenOptions={stackOpts}>
      <AccountStack.Screen name="Account" component={AccountScreen} options={{ title: 'Account' }} />
    </AccountStack.Navigator>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: colors.ink[950], borderTopColor: colors.ink[800] },
        tabBarActiveTintColor: colors.accent[300],
        tabBarInactiveTintColor: colors.ink[400],
      }}
    >
      <Tab.Screen name="HomeTab"    component={HomeNav}    options={{ title: 'Shop',    tabBarIcon: () => <Text>🏠</Text> }} />
      <Tab.Screen name="CartTab"    component={CartNav}    options={{ title: 'Cart',    tabBarIcon: () => <Text>🛒</Text> }} />
      <Tab.Screen name="OrdersTab"  component={OrdersNav}  options={{ title: 'Orders',  tabBarIcon: () => <Text>📦</Text> }} />
      <Tab.Screen name="AccountTab" component={AccountNav} options={{ title: 'Account', tabBarIcon: () => <Text>👤</Text> }} />
    </Tab.Navigator>
  );
}

export function RootNavigator() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return (
    <RootStack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ink[950] } }}>
      {!user
        ? (
          <>
            <RootStack.Screen name="Onboarding" component={OnboardingScreen} />
            <RootStack.Screen name="Auth" component={AuthNav} />
            <RootStack.Screen name="Main" component={MainTabs} />
          </>
        )
        : (
          <>
            <RootStack.Screen name="Main" component={MainTabs} />
            <RootStack.Screen name="Auth" component={AuthNav} />
          </>
        )}
    </RootStack.Navigator>
  );
}

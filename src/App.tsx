import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { AppProvider, useApp } from './lib/store';
import { BottomNav, Toast, SyncBanner, Loader } from './ui';
import { Welcome, Onboarding, Logo } from './screens/Auth';
import { Home } from './screens/Home';
import { SalesList, NewSale, SaleDetail } from './screens/Sales';
import { KhataList, CustomerDetail, CustomerForm } from './screens/Khata';
import { InventoryList, ProductForm, ProductDetail } from './screens/Inventory';
import { More, Expenses, AddExpense, Settings, SyncQueue } from './screens/More';

const TAB_ROOTS = ['/', '/sales', '/khata', '/inventory', '/more'];

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

function Shell() {
  const { ready, signedIn, business, demo } = useApp();
  const { pathname } = useLocation();
  if (!ready) return <div className="splash"><Logo size={72} /><Loader /></div>;
  if (!signedIn) return <Welcome />;
  if (!business || pathname === '/onboarding/new') return <Onboarding />;
  const showNav = TAB_ROOTS.includes(pathname);
  return (
    <div className={'app' + (showNav ? ' has-nav' : '')}>
      {demo && <div className="demo-ribbon">DEMO</div>}
      <SyncBanner />
      <ScrollTop />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/sales" element={<SalesList />} />
        <Route path="/sales/new" element={<NewSale />} />
        <Route path="/sales/:id" element={<SaleDetail />} />
        <Route path="/khata" element={<KhataList />} />
        <Route path="/khata/new" element={<CustomerForm />} />
        <Route path="/khata/:id" element={<CustomerDetail />} />
        <Route path="/khata/:id/edit" element={<CustomerForm />} />
        <Route path="/inventory" element={<InventoryList />} />
        <Route path="/inventory/new" element={<ProductForm />} />
        <Route path="/inventory/:id" element={<ProductDetail />} />
        <Route path="/inventory/:id/edit" element={<ProductForm />} />
        <Route path="/expenses" element={<Expenses />} />
        <Route path="/expenses/new" element={<AddExpense />} />
        <Route path="/more" element={<More />} />
        <Route path="/more/settings" element={<Settings />} />
        <Route path="/more/sync" element={<SyncQueue />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {showNav && <BottomNav />}
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <HashRouter><Shell /></HashRouter>
      <Toast />
    </AppProvider>
  );
}

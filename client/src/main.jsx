import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { CartProvider } from './context/CartContext';
import { WishlistProvider } from './context/WishlistContext';
import './styles/global.css';
// Feature stylesheets load after global.css so they inherit its custom
// properties and can override component rules without !important. Kept as
// separate files rather than appended to global.css, which is already 15k
// lines and became a merge bottleneck whenever two features were built at once.
import './styles/features/totp.css';
import './styles/features/catalog.css';
import './styles/features/orders.css';
import './styles/features/stock-alerts.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <CartProvider>
            <WishlistProvider>
              <App />
            </WishlistProvider>
          </CartProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);

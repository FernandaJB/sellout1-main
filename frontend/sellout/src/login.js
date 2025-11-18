import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './css/login.css';

const Login = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  // Animación de entrada (conserva tu UI original)
  useEffect(() => {
    const form = document.querySelector('.login-form');
    if (form) {
      form.style.opacity = '0';
      form.style.transform = 'translateY(20px)';
      setTimeout(() => {
        form.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
        form.style.opacity = '1';
        form.style.transform = 'translateY(0)';
      }, 100);
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      // SOLO endpoint nuevo (JSON)
      const response = await fetch('/api-keycloak/security/loginPrueba', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        throw new Error('Credenciales inválidas o error de servidor');
      }

      const data = await response.json();
      if (!data?.token || !data?.user) {
        throw new Error('Respuesta inesperada del servidor');
      }

      const { token, user } = data;

      // Validar acceso para 360CORP (por defecto si no existe appName en LS)
      const rolesPorEmpresa = user.rolesPorEmpresa || {};
      const appName = (localStorage.getItem('appName') || 'USUARIO-METAPLUS').toUpperCase();
      if (!rolesPorEmpresa[appName]) {
        throw new Error('No tienes acceso a esta aplicación.');
      }

      // Persistencia (respetando tus claves en localStorage)
      localStorage.setItem('access_token', token);
      localStorage.setItem('username', user.username || username);
      if (user.email) localStorage.setItem('userEmail', user.email);
      if (user.id) localStorage.setItem('userId', String(user.id));
      localStorage.setItem('displayName', user.username || username);
      localStorage.setItem('rolesPorEmpresa', JSON.stringify(rolesPorEmpresa));
      localStorage.setItem('rolesAppActual', JSON.stringify(rolesPorEmpresa[appName] || []));

      // Animación de éxito antes de redirigir (mantiene tu comportamiento)
      const form = document.querySelector('.login-form');
      const go = () => {
        onLogin({ username: user.username || username, email: user.email, roles: rolesPorEmpresa });
        navigate('/');
      };
      if (form) {
        form.style.transition = 'transform 0.5s ease, opacity 0.5s ease';
        form.style.transform = 'scale(1.03)';
        setTimeout(() => {
          form.style.opacity = '0';
          form.style.transform = 'scale(0.95)';
          setTimeout(go, 300);
        }, 200);
      } else {
        go();
      }
    } catch (err) {
      const msg = err?.message || 'Error al iniciar sesión';
      setError(msg);

      // Animación de sacudida (mantiene tu feedback visual)
      const inputFields = document.querySelectorAll('.input-field');
      inputFields.forEach((field) => {
        field.style.transition = 'transform 0.1s ease';
        field.style.transform = 'translateX(10px)';
        setTimeout(() => {
          field.style.transform = 'translateX(-10px)';
          setTimeout(() => {
            field.style.transform = 'translateX(0)';
          }, 100);
        }, 100);
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-form compact-form">
        <h2 className="login-title">Iniciar sesión</h2>
        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <label htmlFor="username" className="input-label">Usuario o Cédula</label>
            <input
              id="username"
              name="username"
              type="text"
              required
              className="input-field"
              placeholder="Ingrese su usuario o cédula"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="input-group">
            <label htmlFor="password" className="input-label">Contraseña</label>
            <input
              id="password"
              name="password"
              type="password"
              required
              className="input-field"
              placeholder="Ingrese su contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <div className="error-message">{error}</div>}
          <button type="submit" className="submit-button" disabled={isLoading}>
            {isLoading ? (
              <>
                <svg className="spinner" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Iniciando...
              </>
            ) : 'Iniciar sesión'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Login;

import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Toast } from 'primereact/toast';
import './css/olvidarContrasenia.css';

const OlvidarContraseña = () => {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [processing, setProcessing] = useState(false);
  const toast = useRef(null);
  const navigate = useNavigate();

  const validateEmail = (email) => {
    const re = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,4}$/;
    return re.test(String(email).toLowerCase());
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!email.trim()) {
      setError('El correo electrónico es requerido');
      return;
    }

    if (!validateEmail(email)) {
      setError('Ingrese un correo electrónico válido');
      return;
    }

    setProcessing(true);

    try {
      const response = await fetch('/api-keycloak/security/forgotPassword', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });

      if (response.ok) {
        setSuccess('Se ha enviado un código de verificación a su correo electrónico');
        toast.current.show({ 
          severity: 'success', 
          summary: 'Éxito', 
          detail: 'Se ha enviado un código de verificación a su correo electrónico' 
        });
        
        // Redirigir al usuario a la página de restablecimiento de contraseña después de 3 segundos
        setTimeout(() => {
          navigate('/restablecer-contrasenia');
        }, 3000);
      } else {
        const errorData = await response.json();
        setError(errorData.message || 'Error al enviar el código de verificación');
        toast.current.show({ 
          severity: 'error', 
          summary: 'Error', 
          detail: errorData.message || 'Error al enviar el código de verificación' 
        });
      }
    } catch (error) {
      setError('Error de conexión. Intente nuevamente más tarde.');
      toast.current.show({ 
        severity: 'error', 
        summary: 'Error', 
        detail: 'Error de conexión. Intente nuevamente más tarde.' 
      });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="forgot-container">
      <div className="forgot-form">
        <h2 className="forgot-title">Recuperar Contraseña</h2>
        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <label htmlFor="email" className="input-label">Correo Electrónico</label>
            <input
              id="email"
              type="email"
              className="input-field"
              placeholder="Ingrese su correo electrónico"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            {error && <div className="error-message">{error}</div>}
            {success && <div className="success-message">{success}</div>}
          </div>
          
          <button
            type="submit"
            className="submit-button"
            disabled={processing}
          >
            {processing ? 'Enviando...' : 'Enviar Código de Verificación'}
          </button>
          
          <button
            type="button"
            className="back-button"
            onClick={() => navigate('/login')}
            disabled={processing}
          >
            Regresar al Login
          </button>
        </form>
      </div>
      <Toast ref={toast} />
    </div>
  );
};

export default OlvidarContraseña;
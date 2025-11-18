import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Toast } from 'primereact/toast';
import './css/restablecerContrasenia.css';

const RestablecerContrasenia = () => {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [processing, setProcessing] = useState(false);
  const toast = useRef(null);
  const navigate = useNavigate();

  const validateEmail = (email) => {
    const re = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,4}$/;
    return re.test(String(email).toLowerCase());
  };

  const validatePassword = (password) => {
    // Entre 8 y 10 caracteres, al menos una mayúscula, una minúscula y un número
    const re = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d]{8,10}$/;
    return re.test(password);
  };

  const validateForm = () => {
    const newErrors = {};

    if (!email.trim()) newErrors.email = 'El correo electrónico es requerido';
    else if (!validateEmail(email)) newErrors.email = 'Ingrese un correo electrónico válido';

    if (!code.trim()) newErrors.code = 'El código de verificación es requerido';
    else if (code.length !== 6) newErrors.code = 'El código debe tener 6 dígitos';

    if (!newPassword) newErrors.newPassword = 'La nueva contraseña es requerida';
    else if (!validatePassword(newPassword)) {
      newErrors.newPassword = 'La contraseña debe tener entre 8 y 10 caracteres, incluyendo al menos una mayúscula, una minúscula y un número';
    }

    if (!confirmPassword) newErrors.confirmPassword = 'Confirme la nueva contraseña';
    else if (newPassword !== confirmPassword) newErrors.confirmPassword = 'Las contraseñas no coinciden';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      toast.current.show({ severity: 'error', summary: 'Error', detail: 'Por favor, corrija los errores en el formulario' });
      return;
    }

    setProcessing(true);

    const formData = new URLSearchParams();
    formData.append('email', email);
    formData.append('code', code);
    formData.append('newPassword', newPassword);
    formData.append('confirmPassword', confirmPassword);

    try {
      const response = await fetch('/api-keycloak/security/resetPassword', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      });

      if (response.ok) {
        toast.current.show({ severity: 'success', summary: 'Éxito', detail: 'Contraseña restablecida exitosamente' });
        setTimeout(() => {
          setEmail('');
          setCode('');
          setNewPassword('');
          setConfirmPassword('');
          navigate('/');
        }, 4000);
      } else {
        const errorMessage = await response.text();
        toast.current.show({ severity: 'error', summary: 'Error', detail: `Error: ${errorMessage}` });
      }
    } catch (error) {
      toast.current.show({ severity: 'error', summary: 'Error', detail: `Error: ${error.message}` });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="reset-container">
      <div className="reset-form">
        <h2 className="reset-title">Restablecer Contraseña</h2>
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
            {errors.email && <div className="error-message">{errors.email}</div>}
          </div>
          
          <div className="input-group">
            <label htmlFor="code" className="input-label">Código de Verificación</label>
            <input
              id="code"
              type="text"
              className="input-field"
              placeholder="Ingrese el código de 6 dígitos"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
            {errors.code && <div className="error-message">{errors.code}</div>}
          </div>
          
          <div className="input-group">
            <label htmlFor="newPassword" className="input-label">Nueva Contraseña</label>
            <input
              id="newPassword"
              type="password"
              className="input-field"
              placeholder="Ingrese su nueva contraseña"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
            {errors.newPassword && <div className="error-message">{errors.newPassword}</div>}
          </div>
          
          <div className="input-group">
            <label htmlFor="confirmPassword" className="input-label">Confirmar Contraseña</label>
            <input
              id="confirmPassword"
              type="password"
              className="input-field"
              placeholder="Confirme su nueva contraseña"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
            {errors.confirmPassword && <div className="error-message">{errors.confirmPassword}</div>}
          </div>
          
          <button
            type="submit"
            className="submit-button"
            disabled={processing}
          >
            {processing ? 'Procesando...' : 'Restablecer Contraseña'}
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

export default RestablecerContrasenia;
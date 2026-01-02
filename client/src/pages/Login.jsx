import { useState } from 'react';
import { login } from '../services/auth.js';
import { useNavigate, Link } from 'react-router-dom';
import { connectSocket } from '../socket';

export default function Login() {
  const [emailOrUsername, setEmailOrUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const { token } = await login({ emailOrUsername, password });
      localStorage.setItem('token', token);

      // Connect socket with token
      connectSocket();

      navigate('/dashboard');
    } catch (err) {
      setError(err.message);
    }
  };

  // --- NEW STYLES ---
  const containerStyle = {
    maxWidth: '400px',
    margin: '4rem auto',
    padding: '2rem',
    backgroundColor: '#1a1a1a',
    borderRadius: '12px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    textAlign: 'center',
    fontFamily: 'system-ui, sans-serif'
  };

  const inputStyle = {
    width: '100%',
    padding: '12px',
    margin: '8px 0',
    borderRadius: '8px',
    border: '1px solid #444',
    backgroundColor: '#2a2a2a',
    color: 'white',
    fontSize: '16px',
    boxSizing: 'border-box' // Ensures padding doesn't break width
  };

  const buttonStyle = {
    width: '100%',
    padding: '12px',
    marginTop: '16px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#646cff',
    color: 'white',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'background-color 0.2s'
  };

  return (
    <div style={containerStyle}>
      <h2 style={{ marginTop: 0, marginBottom: '1.5rem', color: '#fff' }}>Login</h2>
      <form onSubmit={handleSubmit}>
        <input 
          style={inputStyle}
          placeholder="Email or Username" 
          value={emailOrUsername} 
          onChange={e => setEmailOrUsername(e.target.value)} 
        />
        <input 
          style={inputStyle}
          placeholder="Password" 
          type="password" 
          value={password} 
          onChange={e => setPassword(e.target.value)} 
        />
        <button 
            type="submit" 
            style={buttonStyle}
            onMouseOver={(e) => e.target.style.backgroundColor = '#535bf2'}
            onMouseOut={(e) => e.target.style.backgroundColor = '#646cff'}
        >
            Login
        </button>
      </form>
      
      {error && <p style={{ color: '#ff6b6b', marginTop: '1rem' }}>{error}</p>}
      
      <p style={{ marginTop: '1.5rem', color: '#888' }}>
        Don't have an account? <Link to="/register" style={{ color: '#646cff' }}>Register</Link>
      </p>
    </div>
  );
}
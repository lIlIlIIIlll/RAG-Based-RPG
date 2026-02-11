import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Terminal, ArrowRight, User, Mail, Lock, Sparkles } from 'lucide-react';
import * as api from '../../services/api';
import styles from './AuthPage.module.css';
import CinematicLoading from '../ui/CinematicLoading';

const AuthPage = () => {
    const [isLogin, setIsLogin] = useState(true);
    const navigate = useNavigate();
    const submitButtonRef = useRef(null);
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        password: ''
    });

    const [isLoading, setIsLoading] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState("");

    const [loadingStatus, setLoadingStatus] = useState('loading'); // 'loading', 'success', 'error'
    const [errorMessage, setErrorMessage] = useState("");

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsLoading(true);
        setLoadingStatus('loading');
        setLoadingMessage(isLogin ? "Autenticando..." : "Criando sua conta...");
        setErrorMessage("");

        // Small delay for cinematic effect
        await new Promise(resolve => setTimeout(resolve, 2000));

        try {
            if (isLogin) {
                const { token } = await api.login(formData.email, formData.password);
                localStorage.setItem('token', token);

                // Anticipation phase
                setLoadingStatus('anticipate-success');
                await new Promise(resolve => setTimeout(resolve, 1000));

                setLoadingStatus('success');
                setLoadingMessage("Entrando no Reino...");
                setTimeout(() => navigate('/chat'), 1500);
            } else {
                const { token } = await api.register(formData.name, formData.email, formData.password);
                localStorage.setItem('token', token);

                // Anticipation phase
                setLoadingStatus('anticipate-success');
                await new Promise(resolve => setTimeout(resolve, 1000));

                setLoadingStatus('success');
                setLoadingMessage("Preparando sua jornada...");
                setTimeout(() => navigate('/chat'), 1500);
            }
        } catch (error) {
            console.error("Auth error:", error);

            // Anticipation phase for error
            setLoadingStatus('anticipate-error');
            await new Promise(resolve => setTimeout(resolve, 1000));

            setLoadingStatus('error');

            // Handle rate limiting (429) and auth errors with remaining attempts
            const responseData = error.response?.data;
            let errorMsg = responseData?.error || "Falha na autenticação";

            if (responseData?.remainingAttempts !== undefined && responseData.remainingAttempts > 0) {
                errorMsg += ` (${responseData.remainingAttempts} tentativa(s) restante(s))`;
            } else if (error.response?.status === 429) {
                // Already includes the time in the error message from backend
            }

            setErrorMessage(errorMsg);

            setTimeout(() => {
                setIsLoading(false);
                setLoadingStatus('loading'); // Reset for next time
            }, 3000);
        }
    };

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            submitButtonRef.current.click();
        }
    };

    return (
        <div className={styles.container}>
            {isLoading && (
                <CinematicLoading
                    message={loadingMessage}
                    status={loadingStatus}
                    errorMessage={errorMessage}
                />
            )}
            <div className={styles.backgroundEffects}>
                <div className={styles.glowOrb1} />
                <div className={styles.glowOrb2} />
            </div>

            <div className={styles.contentWrapper}>
                <div className={styles.brandSection}>
                    <div className={styles.logoContainer}>
                        <Terminal size={48} className={styles.logoIcon} />
                        <div className={styles.logoGlow} />
                    </div>
                    <h1 className={styles.brandTitle}>Dungeon Master</h1>
                    <p className={styles.brandSubtitle}>
                        Experimente o próximo nível de RPG com IA.
                        <br />
                        Entre e jogue seu RPG de Mesa.
                    </p>
                </div>

                <div className={styles.cardContainer}>
                    <div className={styles.glassCard}>
                        <div className={styles.cardHeader}>
                            <h2>{isLogin ? 'Bem-vindo de volta' : 'Criar uma conta'}</h2>
                            <p>{isLogin ? 'Faça login para continuar a campanha' : 'Cadastre-se para jogar criar uma campanha'}</p>
                        </div>

                        <form onSubmit={handleSubmit} className={styles.form}>
                            <div className={`${styles.collapsibleWrapper} ${!isLogin ? styles.show : ''}`}>
                                <div className={styles.overflowHandler}>
                                    <div className={styles.inputGroup}>
                                        <User size={20} className={styles.inputIcon} />
                                        <input
                                            type="text"
                                            name="name"
                                            placeholder="Apelido"
                                            value={formData.name}
                                            onChange={handleChange}
                                            onKeyDown={handleKeyDown}
                                            className={styles.input}
                                            required={!isLogin}
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className={styles.inputGroup}>
                                <Mail size={20} className={styles.inputIcon} />
                                <input
                                    type="email"
                                    name="email"
                                    placeholder="Endereço de E-mail"
                                    value={formData.email}
                                    onChange={handleChange}
                                    onKeyDown={handleKeyDown}
                                    className={styles.input}
                                    required
                                />
                            </div>

                            <div className={styles.inputGroup}>
                                <Lock size={20} className={styles.inputIcon} />
                                <input
                                    type="password"
                                    name="password"
                                    placeholder="Senha"
                                    value={formData.password}
                                    onChange={handleChange}
                                    onKeyDown={handleKeyDown}
                                    className={styles.input}
                                    required
                                />
                            </div>

                            <button ref={submitButtonRef} type="submit" className={styles.submitButton} disabled={isLoading}>
                                <span>{isLogin ? 'Entrar' : 'Criar Conta'}</span>
                                <ArrowRight size={20} />
                                <div className={styles.buttonGlow} />
                            </button>
                        </form>

                        <div className={styles.divider}>
                            <span>ou</span>
                        </div>

                        <button
                            onClick={() => setIsLogin(!isLogin)}
                            className={styles.toggleButton}
                            disabled={isLoading}
                        >
                            {isLogin ? "Não tem uma conta? Cadastre-se" : 'Já tem uma conta? Entrar'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AuthPage;

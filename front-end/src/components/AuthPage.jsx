import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Terminal, ArrowRight, User, Mail, Lock, Sparkles } from 'lucide-react';
import * as api from '../services/api';
import styles from './AuthPage.module.css';

const AuthPage = () => {
    const [isLogin, setIsLogin] = useState(true);
    const navigate = useNavigate();
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        password: ''
    });

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            if (isLogin) {
                const { token } = await api.login(formData.email, formData.password);
                localStorage.setItem('token', token);
                navigate('/chat');
            } else {
                const { token } = await api.register(formData.name, formData.email, formData.password);
                localStorage.setItem('token', token);
                navigate('/chat');
            }
        } catch (error) {
            console.error("Auth error:", error);
            alert(error.response?.data?.error || "Authentication failed");
        }
    };

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    return (
        <div className={styles.container}>
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
                    <h1 className={styles.brandTitle}>Dungeon Master 69</h1>
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
                                    className={styles.input}
                                    required
                                />
                            </div>

                            <button type="submit" className={styles.submitButton}>
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

import { Link } from 'react-router-dom';
import styles from './Header.module.css';

export function Header() {
  return (
    <header className={styles.header}>
      <div className={styles.container}>
        <Link to="/" className={styles.logo}>
          <img src="/hockey-puck.svg" alt="" className={styles.icon} />
          <span className={styles.title}>Olympic Hockey Pick'em</span>
        </Link>
        <nav className={styles.nav}>
          <Link to="/" className={styles.link}>Games</Link>
          <Link to="/leaderboard" className={styles.link}>Leaderboard</Link>
          <Link to="/standings" className={styles.link}>Standings</Link>
        </nav>
      </div>
    </header>
  );
}

export default Header;

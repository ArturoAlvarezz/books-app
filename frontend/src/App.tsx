import { useEffect, useState } from "react";
import { Book, getToken, setSessionExpiredHandler, setToken } from "./api";
import Library from "./components/Library";
import Login from "./components/Login";
import Reader from "./components/Reader";
import "./style.css";

export default function App() {
  const [authenticated, setAuthenticated] = useState(() => Boolean(getToken()));
  const [reading, setReading] = useState<Book | null>(null);

  useEffect(() => {
    setSessionExpiredHandler(() => {
      setReading(null);
      setAuthenticated(false);
    });
  }, []);

  const logout = () => {
    setToken("");
    setReading(null);
    setAuthenticated(false);
  };

  if (!authenticated) return <Login onLogin={() => setAuthenticated(true)} />;
  if (reading) return <Reader book={reading} onBack={() => setReading(null)} />;
  return <Library onRead={setReading} onLogout={logout} />;
}

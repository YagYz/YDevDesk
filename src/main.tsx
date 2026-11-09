import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";

// StrictMode bilinçli olarak kullanılmıyor: terminal/PTY oturumları yan etkili ve çift mount'a duyarlı.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);

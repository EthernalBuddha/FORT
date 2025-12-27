import "./safe.css";

export default function SafeLayout({ children }) {
  return <div className="safeScope">{children}</div>;
}

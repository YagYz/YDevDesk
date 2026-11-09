import { DataProvider } from "./context/DataContext";
import Workspace from "./Workspace";

export default function App() {
  return (
    <DataProvider>
      <Workspace />
    </DataProvider>
  );
}

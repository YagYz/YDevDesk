import { Flame } from "lucide-react";
import { useData } from "../context/DataContext";
import { Empty, PanelBody } from "../components/ui";

export default function FileHeatPanel() {
  const { agent } = useData();
  const max = Math.max(1, ...agent.file_heat.map((f) => f.count));
  return (
    <PanelBody>
      {agent.file_heat.length === 0 ? (
        <Empty icon={<Flame className="w-5 h-5" />} title="Dosya yoğunluğu boş" hint="Ajan dosya okuyup yazdıkça en çok dokunulanlar listelenir." />
      ) : (
        <ul className="space-y-2">
          {agent.file_heat.map((f) => (
            <li key={f.name}>
              <div className="flex justify-between text-[11px] mb-1">
                <span className="font-mono truncate">{f.name}</span>
                <span className="text-[var(--txt-dim)] font-mono">{f.count}</span>
              </div>
              <div className="h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${(f.count / max) * 100}%`, background: "linear-gradient(90deg,var(--petrol),var(--accent))" }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </PanelBody>
  );
}

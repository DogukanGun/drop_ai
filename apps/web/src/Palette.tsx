import { useFlow } from './store';
import type { PaletteEntry } from './seedNodes';

const categoryOrder = ['IO', 'Browser', 'Research', 'Knowledge', 'Transform'];

export function Palette() {
  const palette = useFlow(s => s.palette);
  const grouped = new Map<string, PaletteEntry[]>();
  for (const n of palette) {
    if (!grouped.has(n.category)) grouped.set(n.category, []);
    grouped.get(n.category)!.push(n);
  }
  const cats = [...grouped.keys()].sort((a, b) => {
    const ai = categoryOrder.indexOf(a);
    const bi = categoryOrder.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  return (
    <aside className="palette">
      {cats.map(cat => (
        <div key={cat}>
          <h2>{cat}</h2>
          {grouped.get(cat)!.map(n => (
            <div
              key={n.type}
              className="palette-item"
              draggable
              onDragStart={e => {
                e.dataTransfer.setData('application/dropai-node-type', n.type);
                e.dataTransfer.effectAllowed = 'move';
              }}
              title={n.description}
            >
              <span className="swatch" style={{ background: n.color }} />
              <div>
                <div className="name">{n.label}</div>
                <div className="desc">{n.description}</div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </aside>
  );
}

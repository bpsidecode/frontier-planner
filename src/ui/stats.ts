import type { PopulationSummary } from '../model/houses';

export function renderStats(root: HTMLElement, s: PopulationSummary) {
  const rows = s.byLevel
    .map(
      ({ level, count, residents }) => `
      <tr class="${count ? '' : 'dim'}">
        <td><span class="lvl" style="background:${level.color}${level.level === 5 ? ';box-shadow:0 0 0 2px #facc15' : ''}">${level.level}</span>${level.name}</td>
        <td class="num">${Number.isFinite(level.minPct) ? `≥${level.minPct}%` : '&lt;30%'}</td>
        <td class="num">${level.residents}</td>
        <td class="num">${count}</td>
        <td class="num">${residents}</td>
      </tr>`,
    )
    .join('');
  root.innerHTML = `
    <div class="pop">
      <div class="pop-total">${s.total}</div>
      <div class="pop-label">residents<br><span>${s.houses} house${s.houses === 1 ? '' : 's'}</span></div>
    </div>
    <table class="levels">
      <thead><tr><th>Level</th><th class="num">Needs</th><th class="num">Each</th><th class="num">Houses</th><th class="num">People</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/* 完成率统计页（店长）*/
App.pages.dashboard = (function () {
  function rateBar(rate) {
    const color = rate >= 90 ? 'var(--ok)' : rate >= 60 ? 'var(--warn)' : 'var(--danger)';
    return `<div style="display:flex;align-items:center;gap:10px">
      <div class="progress" style="flex:1"><span style="width:${rate}%"></span></div>
      <b style="width:52px;text-align:right;color:${color}">${rate}%</b>
    </div>`;
  }

  function tableRows(rows, nameLabel) {
    if (!rows.length) return '<tr><td colspan="4" class="empty-tip">暂无数据</td></tr>';
    return rows.map((r) => `<tr>
      <td>${h(r.name)}</td>
      <td class="num">${r.total}</td>
      <td class="num">${r.done} / ${r.total - r.done}</td>
      <td style="min-width:200px">${rateBar(r.rate)}</td>
    </tr>`).join('');
  }

  async function render(view, app) {
    const s = await api.get('/api/stats/summary');
    const openRate = s.total ? Math.round((s.open / s.total) * 1000) / 10 : 0;

    view.innerHTML = `
      <h2 class="page-title">📊 完成率统计</h2>
      <p class="page-desc">全店质检整改完成情况汇总，支持按房间、质检员、楼层维度查看。</p>

      <div class="grid-4">
        <div class="card stat-card">
          <div class="stat-num">${s.total}</div>
          <div class="stat-label">质检问题总数（条）</div>
        </div>
        <div class="card stat-card">
          <div class="stat-num green">${s.done}</div>
          <div class="stat-label">已整改完成（条）</div>
        </div>
        <div class="card stat-card">
          <div class="stat-num amber">${s.open}</div>
          <div class="stat-label">待整改（条）</div>
        </div>
        <div class="card stat-card">
          <div class="stat-num ${s.completionRate < 60 ? 'red' : 'green'}">${s.completionRate}%</div>
          <div class="stat-label">总体完成率${s.total ? '' : '（暂无数据）'}</div>
        </div>
      </div>

      <div class="card">
        <h3>总体完成率</h3>
        <div style="max-width:640px">${rateBar(s.completionRate)}</div>
        <p class="hint" style="margin-top:10px">
          全店共 ${s.total} 条问题，已完成 ${s.done} 条，待整改 ${s.open} 条（占 ${openRate}%），累计扣分 ${s.totalDeduction} 分。
        </p>
      </div>

      <div class="grid-2">
        <div class="card">
          <h3>🏢 按房间完成率</h3>
          <div class="table-scroll">
            <table class="tbl">
              <thead><tr><th>房间号</th><th class="num">问题数</th><th class="num">已/待</th><th>完成率</th></tr></thead>
              <tbody>${tableRows(s.byRoom)}</tbody>
            </table>
          </div>
        </div>
        <div class="card">
          <h3>🧹 按质检员</h3>
          <div class="table-scroll">
            <table class="tbl">
              <thead><tr><th>质检员</th><th class="num">上报数</th><th class="num">已/待</th><th>完成率</th></tr></thead>
              <tbody>${tableRows(s.byInspector)}</tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="card">
        <h3>🗂️ 按楼层 / 区域</h3>
        <div class="table-scroll">
          <table class="tbl">
            <thead><tr><th>楼层 / 区域</th><th class="num">问题数</th><th class="num">已/待</th><th>完成率</th><th class="num">扣分合计</th></tr></thead>
            <tbody>
              ${s.byFloor.length ? s.byFloor.map((r) => `<tr>
                <td>${h(r.name)}</td>
                <td class="num">${r.total}</td>
                <td class="num">${r.done} / ${r.total - r.done}</td>
                <td style="min-width:200px">${rateBar(r.rate)}</td>
                <td class="num">${r.deduction}</td>
              </tr>`).join('') : '<tr><td colspan="5" class="empty-tip">暂无数据</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  return { render };
})();

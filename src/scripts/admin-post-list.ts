const managerElement = document.querySelector<HTMLElement>('#post-manager');

if (managerElement) {
  const manager = managerElement;
  const search = manager.querySelector<HTMLInputElement>('#post-search')!;
  const statusFilter = manager.querySelector<HTMLSelectElement>('#post-status-filter')!;
  const selectAll = manager.querySelector<HTMLInputElement>('#post-select-all')!;
  const selectionCount = manager.querySelector<HTMLElement>('#post-selection-count')!;
  const bulkAction = manager.querySelector<HTMLSelectElement>('#post-bulk-action')!;
  const bulkApply = manager.querySelector<HTMLButtonElement>('#post-bulk-apply')!;
  const message = manager.querySelector<HTMLElement>('#post-manager-message')!;
  const emptyFilter = manager.querySelector<HTMLElement>('#post-empty-filter')!;
  const rows = [...manager.querySelectorAll<HTMLElement>('[data-post-row]')];
  const csrfToken = manager.dataset.csrf || '';
  let busy = false;

  const rowCheckbox = (row: HTMLElement) => row.querySelector<HTMLInputElement>('[data-post-select]')!;
  const visibleRows = () => rows.filter((row) => !row.hidden);
  const selectedRows = () => rows.filter((row) => rowCheckbox(row).checked);

  function showMessage(text: string, kind: 'error' | 'success' | 'info' = 'info') {
    message.textContent = text;
    message.hidden = !text;
    message.dataset.kind = kind;
  }

  function updateSelection() {
    const visible = visibleRows();
    const visibleSelected = visible.filter((row) => rowCheckbox(row).checked).length;
    const selected = selectedRows().length;
    selectAll.checked = visible.length > 0 && visibleSelected === visible.length;
    selectAll.indeterminate = visibleSelected > 0 && visibleSelected < visible.length;
    selectionCount.textContent = `${selected} selected`;
    bulkApply.disabled = busy || selected === 0 || !bulkAction.value;
  }

  function filterRows() {
    const query = search.value.trim().toLocaleLowerCase('en-US');
    const status = statusFilter.value;
    let visible = 0;
    for (const row of rows) {
      const matchesSearch = !query || (row.dataset.postSearch || '').includes(query);
      const matchesStatus = status === 'all' || row.dataset.postStatus === status;
      row.hidden = !(matchesSearch && matchesStatus);
      if (!row.hidden) visible += 1;
    }
    emptyFilter.hidden = visible !== 0;
    updateSelection();
  }

  async function updatePosts(ids: string[], action: 'trash' | 'restore') {
    if (busy || !ids.length) return;
    const verb = action === 'trash' ? 'move to trash' : 'restore as drafts';
    if (!window.confirm(`${verb[0].toUpperCase()}${verb.slice(1)} ${ids.length} selected post${ids.length === 1 ? '' : 's'}?`)) return;

    busy = true;
    manager.querySelectorAll<HTMLButtonElement>('button').forEach((button) => { button.disabled = true; });
    showMessage(action === 'trash' ? 'Moving selected posts to trash…' : 'Restoring selected posts…');
    try {
      const response = await fetch('/api/admin/posts/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ ids, action }),
      });
      const contentType = response.headers.get('content-type') || '';
      const result = contentType.includes('application/json') ? await response.json() : { error: await response.text() };
      if (!response.ok) throw new Error(result.error || 'Unable to update the selected posts.');
      const changed = Number(result.changed || 0);
      showMessage(`${changed} post${changed === 1 ? '' : 's'} ${action === 'trash' ? 'moved to trash' : 'restored as drafts'}.`, 'success');
      window.setTimeout(() => window.location.reload(), 500);
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Unable to update the selected posts.', 'error');
      busy = false;
      manager.querySelectorAll<HTMLButtonElement>('button').forEach((button) => { button.disabled = false; });
      updateSelection();
    }
  }

  search.addEventListener('input', filterRows);
  statusFilter.addEventListener('change', filterRows);
  bulkAction.addEventListener('change', updateSelection);
  rows.forEach((row) => rowCheckbox(row).addEventListener('change', updateSelection));

  selectAll.addEventListener('change', () => {
    visibleRows().forEach((row) => { rowCheckbox(row).checked = selectAll.checked; });
    updateSelection();
  });

  bulkApply.addEventListener('click', () => {
    const action = bulkAction.value;
    if (action !== 'trash' && action !== 'restore') return;
    updatePosts(selectedRows().map((row) => row.dataset.postId || '').filter(Boolean), action);
  });

  manager.querySelectorAll<HTMLButtonElement>('[data-post-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.postAction;
      const id = button.dataset.postActionId || '';
      if ((action === 'trash' || action === 'restore') && id) updatePosts([id], action);
    });
  });

  filterRows();
}

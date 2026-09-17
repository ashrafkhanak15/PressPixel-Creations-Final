const pageElement = document.querySelector<HTMLElement>('#admin-posts-page');

if (pageElement) {
  const page = pageElement;
  const manager = page.querySelector<HTMLElement>('#post-manager');
  const message = page.querySelector<HTMLElement>('#post-page-message')!;
  const importButton = page.querySelector<HTMLButtonElement>('#post-import-legacy');
  const tabButtons = [...page.querySelectorAll<HTMLButtonElement>('[data-post-tab]')];
  const csrfToken = page.dataset.csrf || '';
  const allowedStatuses = new Set(['all', 'draft', 'scheduled', 'published', 'trashed']);
  const requestedStatus = new URL(window.location.href).searchParams.get('status') || 'all';
  let activeStatus = allowedStatuses.has(requestedStatus) ? requestedStatus : 'all';
  let busy = false;
  let refreshRows = () => {};

  function showMessage(text: string, kind: 'error' | 'success' | 'info' = 'info') {
    message.textContent = text;
    message.hidden = !text;
    message.dataset.kind = kind;
  }

  async function responseData(response: Response) {
    const contentType = response.headers.get('content-type') || '';
    return contentType.includes('application/json') ? response.json() : { error: await response.text() };
  }

  function setActiveTab(status: string, updateUrl = true) {
    activeStatus = allowedStatuses.has(status) ? status : 'all';
    for (const button of tabButtons) {
      const active = button.dataset.postTab === activeStatus;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    if (updateUrl) {
      const url = new URL(window.location.href);
      if (activeStatus === 'all') url.searchParams.delete('status');
      else url.searchParams.set('status', activeStatus);
      window.history.replaceState(null, '', url);
    }
  }

  tabButtons.forEach((button) => button.addEventListener('click', () => {
    setActiveTab(button.dataset.postTab || 'all');
    refreshRows();
  }));

  if (importButton) {
    importButton.addEventListener('click', async () => {
      if (busy || !window.confirm('Import the bundled existing journal article into Posts? This will not create a duplicate if it was already imported.')) return;
      busy = true;
      importButton.disabled = true;
      showMessage('Importing the existing article…');
      try {
        const response = await fetch('/api/admin/posts/import-legacy', {
          method: 'POST',
          headers: { 'X-CSRF-Token': csrfToken },
        });
        const result = await responseData(response);
        if (!response.ok) throw new Error(result.error || 'Unable to import the existing article.');
        const imported = Array.isArray(result.imported) ? result.imported.length : 0;
        showMessage(imported ? 'Existing article imported successfully.' : 'That article is already part of Posts.', 'success');
        window.setTimeout(() => window.location.reload(), 700);
      } catch (error) {
        showMessage(error instanceof Error ? error.message : 'Unable to import the existing article.', 'error');
        busy = false;
        importButton.disabled = false;
      }
    });
  }

  if (manager) {
    const managerRoot = manager;
    const search = managerRoot.querySelector<HTMLInputElement>('#post-search')!;
    const selectAll = managerRoot.querySelector<HTMLInputElement>('#post-select-all')!;
    const selectionCount = managerRoot.querySelector<HTMLElement>('#post-selection-count')!;
    const bulkAction = managerRoot.querySelector<HTMLSelectElement>('#post-bulk-action')!;
    const bulkApply = managerRoot.querySelector<HTMLButtonElement>('#post-bulk-apply')!;
    const emptyFilter = managerRoot.querySelector<HTMLElement>('#post-empty-filter')!;
    const rows = [...managerRoot.querySelectorAll<HTMLElement>('[data-post-row]')];
    const rowCheckbox = (row: HTMLElement) => row.querySelector<HTMLInputElement>('[data-post-select]')!;
    const visibleRows = () => rows.filter((row) => !row.hidden);
    const selectedRows = () => rows.filter((row) => rowCheckbox(row).checked);

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
      let visible = 0;
      for (const row of rows) {
        const matchesSearch = !query || (row.dataset.postSearch || '').includes(query);
        const matchesStatus = activeStatus === 'all' || row.dataset.postStatus === activeStatus;
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
      managerRoot.querySelectorAll<HTMLButtonElement>('button').forEach((button) => { button.disabled = true; });
      showMessage(action === 'trash' ? 'Moving selected posts to trash…' : 'Restoring selected posts…');
      try {
        const response = await fetch('/api/admin/posts/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
          body: JSON.stringify({ ids, action }),
        });
        const result = await responseData(response);
        if (!response.ok) throw new Error(result.error || 'Unable to update the selected posts.');
        const changed = Number(result.changed || 0);
        showMessage(`${changed} post${changed === 1 ? '' : 's'} ${action === 'trash' ? 'moved to trash' : 'restored as drafts'}.`, 'success');
        window.setTimeout(() => window.location.reload(), 500);
      } catch (error) {
        showMessage(error instanceof Error ? error.message : 'Unable to update the selected posts.', 'error');
        busy = false;
        managerRoot.querySelectorAll<HTMLButtonElement>('button').forEach((button) => { button.disabled = false; });
        updateSelection();
      }
    }

    refreshRows = filterRows;
    search.addEventListener('input', filterRows);
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
    managerRoot.querySelectorAll<HTMLButtonElement>('[data-post-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.dataset.postAction;
        const id = button.dataset.postActionId || '';
        if ((action === 'trash' || action === 'restore') && id) updatePosts([id], action);
      });
    });

    setActiveTab(activeStatus, false);
    filterRows();
  } else {
    setActiveTab(activeStatus, false);
  }
}

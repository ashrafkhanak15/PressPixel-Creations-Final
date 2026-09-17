type Media = { id: string; url: string; width: number; height: number; altText: string; caption: string };
type Block =
  | { id: string; type: 'paragraph'; text: string }
  | { id: string; type: 'heading'; level: 2 | 3; text: string }
  | { id: string; type: 'list'; style: 'unordered' | 'ordered'; items: string[] }
  | { id: string; type: 'quote'; text: string; attribution: string }
  | { id: string; type: 'callout'; title: string; text: string }
  | { id: string; type: 'faq'; question: string; answer: string }
  | { id: string; type: 'reference'; label: string; url: string }
  | { id: string; type: 'image'; mediaId: string; url: string; alt: string; caption: string; width: number; height: number };

type EditorState = { version: 1; blocks: Block[] };

type StoredPost = {
  content: EditorState;
  featuredMedia: Media | null;
};

const rootElement = document.querySelector<HTMLFormElement>('#post-editor');
const stored = document.querySelector<HTMLTextAreaElement>('#post-editor-state');
if (rootElement && stored) {
  const root = rootElement;
  const initial = JSON.parse(stored.value) as StoredPost;
  let content: EditorState = initial.content?.version === 1 ? initial.content : { version: 1, blocks: [] };
  let featuredMedia = initial.featuredMedia || null;
  let busy = false;
  let dirty = false;

  const blocksElement = root.querySelector<HTMLElement>('#editor-blocks')!;
  const addType = root.querySelector<HTMLSelectElement>('#add-block-type')!;
  const message = root.querySelector<HTMLElement>('#editor-message')!;
  const csrfToken = root.dataset.csrf || '';
  const postId = root.dataset.postId || '';
  const uploadsReady = root.dataset.uploadsReady === 'true';
  const initialStatus = root.dataset.postStatus || 'draft';
  const titleInput = root.querySelector<HTMLInputElement>('#post-title')!;
  const slugInput = root.querySelector<HTMLInputElement>('#post-slug')!;
  const featuredPreview = root.querySelector<HTMLElement>('#featured-media-preview')!;
  const featuredUpload = root.querySelector<HTMLButtonElement>('#featured-media-upload')!;

  const markDirty = () => { dirty = true; };
  const showMessage = (text: string, kind: 'error' | 'success' | 'info' = 'info') => {
    message.textContent = text;
    message.hidden = !text;
    message.dataset.kind = kind;
  };
  const field = <T extends HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector: string) => root.querySelector<T>(selector)!;
  const uuid = () => crypto.randomUUID();

  function defaultBlock(type: string): Block {
    const id = uuid();
    switch (type) {
      case 'heading': return { id, type: 'heading', level: 2, text: '' };
      case 'list': return { id, type: 'list', style: 'unordered', items: [''] };
      case 'quote': return { id, type: 'quote', text: '', attribution: '' };
      case 'callout': return { id, type: 'callout', title: '', text: '' };
      case 'faq': return { id, type: 'faq', question: '', answer: '' };
      case 'reference': return { id, type: 'reference', label: '', url: '' };
      case 'image': return { id, type: 'image', mediaId: '', url: '', alt: '', caption: '', width: 0, height: 0 };
      default: return { id, type: 'paragraph', text: '' };
    }
  }

  function makeControl(label: string, element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
    const wrapper = document.createElement('label');
    wrapper.className = 'editor-field';
    const name = document.createElement('span');
    name.textContent = label;
    wrapper.append(name, element);
    return wrapper;
  }

  function input(value: string, placeholder = '') {
    const element = document.createElement('input');
    element.type = 'text';
    element.value = value;
    element.placeholder = placeholder;
    return element;
  }

  function area(value: string, placeholder = '') {
    const element = document.createElement('textarea');
    element.value = value;
    element.placeholder = placeholder;
    element.rows = 4;
    return element;
  }

  function attachChange(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, callback: () => void) {
    element.addEventListener('input', () => { callback(); markDirty(); });
    element.addEventListener('change', () => { callback(); markDirty(); });
  }

  function focusBlock(blockId: string, action?: string) {
    requestAnimationFrame(() => {
      const block = blocksElement.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`);
      (action ? block?.querySelector<HTMLElement>(`[data-block-action="${action}"]`) : block?.querySelector<HTMLElement>('button, input, textarea, select'))?.focus();
    });
  }

  function moveBlock(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= content.blocks.length) return;
    const blockId = content.blocks[index].id;
    [content.blocks[index], content.blocks[target]] = [content.blocks[target], content.blocks[index]];
    markDirty();
    renderBlocks();
    focusBlock(blockId, direction === -1 ? 'up' : 'down');
  }

  function blockToolbar(index: number, name: string) {
    const toolbar = document.createElement('div');
    toolbar.className = 'editor-block__toolbar';
    const label = document.createElement('span');
    label.textContent = name;
    toolbar.append(label);
    const actions: Array<[string, () => void, boolean]> = [
      ['↑', () => moveBlock(index, -1), index === 0],
      ['↓', () => moveBlock(index, 1), index === content.blocks.length - 1],
    ];
    for (const [textValue, action, disabled] of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = textValue;
      button.disabled = Boolean(disabled);
      button.setAttribute('aria-label', textValue === '↑' ? 'Move block up' : 'Move block down');
      button.dataset.blockAction = textValue === '↑' ? 'up' : 'down';
      button.addEventListener('click', action as () => void);
      toolbar.append(button);
    }
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.className = 'editor-block__remove';
    remove.addEventListener('click', () => {
      const nextBlockId = content.blocks[index + 1]?.id || content.blocks[index - 1]?.id || '';
      content.blocks.splice(index, 1);
      markDirty();
      renderBlocks();
      if (nextBlockId) focusBlock(nextBlockId);
      else requestAnimationFrame(() => root.querySelector<HTMLButtonElement>('#add-block')?.focus());
    });
    toolbar.append(remove);
    return toolbar;
  }

  function renderImageEditor(block: Extract<Block, { type: 'image' }>, body: HTMLElement) {
    const preview = document.createElement('div');
    preview.className = 'editor-image-preview';
    if (block.url) {
      const image = document.createElement('img');
      image.src = block.url;
      image.alt = block.alt;
      preview.append(image);
    } else {
      preview.textContent = uploadsReady ? 'Choose an image to upload.' : 'Cloudinary image uploads need environment configuration.';
    }
    const upload = document.createElement('button');
    upload.type = 'button';
    upload.className = 'button button-secondary';
    upload.textContent = block.url ? 'Replace image' : 'Upload image';
    upload.disabled = !uploadsReady;
    upload.addEventListener('click', async () => {
      const media = await uploadMedia();
      if (!media) return;
      block.mediaId = media.id;
      block.url = media.url;
      block.width = media.width;
      block.height = media.height;
      block.alt = media.altText;
      block.caption = media.caption;
      markDirty();
      renderBlocks();
    });
    preview.append(upload);
    body.append(preview);
    const alt = input(block.alt, 'Describe the image for readers who cannot see it');
    attachChange(alt, () => { block.alt = alt.value; });
    body.append(makeControl('Alternative text', alt));
    const caption = input(block.caption, 'Optional caption');
    attachChange(caption, () => { block.caption = caption.value; });
    body.append(makeControl('Caption', caption));
  }

  function renderBlock(block: Block, index: number) {
    const article = document.createElement('article');
    article.className = `editor-block editor-block--${block.type}`;
    article.dataset.blockId = block.id;
    const names: Record<Block['type'], string> = { paragraph: 'Paragraph', heading: 'Heading', list: 'List', quote: 'Quote', callout: 'Callout', faq: 'FAQ', reference: 'Reference', image: 'Image' };
    article.append(blockToolbar(index, names[block.type]));
    const body = document.createElement('div');
    body.className = 'editor-block__body';

    if (block.type === 'paragraph') {
      const element = area(block.text, 'Write a paragraph…');
      attachChange(element, () => { block.text = element.value; });
      body.append(makeControl('Paragraph', element));
    } else if (block.type === 'heading') {
      const level = document.createElement('select');
      for (const [value, label] of [['2', 'Section heading (H2)'], ['3', 'Subheading (H3)']]) {
        const option = new Option(label, value);
        option.selected = Number(value) === block.level;
        level.add(option);
      }
      attachChange(level, () => { block.level = Number(level.value) as 2 | 3; });
      body.append(makeControl('Level', level));
      const element = input(block.text, 'Write a heading…');
      attachChange(element, () => { block.text = element.value; });
      body.append(makeControl('Heading', element));
    } else if (block.type === 'list') {
      const style = document.createElement('select');
      style.add(new Option('Bulleted list', 'unordered'));
      style.add(new Option('Numbered list', 'ordered'));
      style.value = block.style;
      attachChange(style, () => { block.style = style.value as 'unordered' | 'ordered'; });
      body.append(makeControl('List style', style));
      const element = area(block.items.join('\n'), 'One item per line');
      attachChange(element, () => { block.items = element.value.split('\n').map((item) => item.trim()).filter(Boolean); });
      body.append(makeControl('Items', element));
    } else if (block.type === 'quote') {
      const quote = area(block.text, 'Write the quotation…');
      attachChange(quote, () => { block.text = quote.value; });
      body.append(makeControl('Quote', quote));
      const attribution = input(block.attribution, 'Optional attribution');
      attachChange(attribution, () => { block.attribution = attribution.value; });
      body.append(makeControl('Attribution', attribution));
    } else if (block.type === 'callout') {
      const title = input(block.title, 'Optional callout title');
      attachChange(title, () => { block.title = title.value; });
      body.append(makeControl('Callout title', title));
      const callout = area(block.text, 'Write the useful takeaway…');
      attachChange(callout, () => { block.text = callout.value; });
      body.append(makeControl('Callout text', callout));
    } else if (block.type === 'faq') {
      const question = input(block.question, 'Ask the question readers search for');
      attachChange(question, () => { block.question = question.value; });
      body.append(makeControl('Question', question));
      const answer = area(block.answer, 'Answer it directly and clearly');
      attachChange(answer, () => { block.answer = answer.value; });
      body.append(makeControl('Answer', answer));
    } else if (block.type === 'reference') {
      const label = input(block.label, 'Source or reference title');
      attachChange(label, () => { block.label = label.value; });
      body.append(makeControl('Reference label', label));
      const url = input(block.url, 'https://example.com/source');
      url.type = 'url';
      attachChange(url, () => { block.url = url.value; });
      body.append(makeControl('Reference URL', url));
    } else if (block.type === 'image') {
      renderImageEditor(block, body);
    }
    article.append(body);
    return article;
  }

  function renderBlocks() {
    blocksElement.replaceChildren();
    if (!content.blocks.length) {
      const empty = document.createElement('p');
      empty.className = 'editor-blocks-empty';
      empty.textContent = 'Add your first block to begin writing.';
      blocksElement.append(empty);
      return;
    }
    content.blocks.forEach((block, index) => blocksElement.append(renderBlock(block, index)));
  }

  function renderFeaturedMedia() {
    featuredPreview.replaceChildren();
    if (!featuredMedia) {
      featuredPreview.textContent = uploadsReady ? 'No featured image selected.' : 'Cloudinary image uploads need environment configuration.';
      return;
    }
    const image = document.createElement('img');
    image.src = featuredMedia.url;
    image.alt = featuredMedia.altText;
    featuredPreview.append(image);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove featured image';
    remove.className = 'editor-media-remove';
    remove.addEventListener('click', () => { featuredMedia = null; markDirty(); renderFeaturedMedia(); });
    featuredPreview.append(remove);
    const alt = input(featuredMedia.altText, 'Describe the image');
    attachChange(alt, () => { if (featuredMedia) featuredMedia.altText = alt.value; });
    featuredPreview.append(makeControl('Alternative text', alt));
    const caption = input(featuredMedia.caption, 'Optional caption');
    attachChange(caption, () => { if (featuredMedia) featuredMedia.caption = caption.value; });
    featuredPreview.append(makeControl('Caption', caption));
  }

  async function uploadMedia(): Promise<Media | null> {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/jpeg,image/png,image/webp,image/avif';
    picker.click();
    const file = await new Promise<File | null>((resolve) => {
      picker.addEventListener('change', () => resolve(picker.files?.[0] || null), { once: true });
      picker.addEventListener('cancel', () => resolve(null), { once: true });
    });
    if (!file) return null;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type) || file.size > 10 * 1024 * 1024) {
      showMessage('Choose a JPG, PNG, WebP or AVIF image no larger than 10 MB.', 'error');
      return null;
    }
    try {
      showMessage('Uploading image…');
      const signed = await fetch('/api/admin/media/sign', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken } });
      const signature = await signed.json();
      if (!signed.ok) throw new Error(signature.error || 'Unable to prepare the image upload.');
      const data = new FormData();
      data.append('file', file);
      data.append('api_key', signature.apiKey);
      data.append('timestamp', String(signature.timestamp));
      data.append('signature', signature.signature);
      data.append('folder', signature.folder);
      const cloudinary = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(signature.cloudName)}/image/upload`, { method: 'POST', body: data });
      const uploaded = await cloudinary.json();
      if (!cloudinary.ok) throw new Error(uploaded.error?.message || 'Cloudinary could not upload this image.');
      const saved = await fetch('/api/admin/media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ publicId: uploaded.public_id, url: uploaded.secure_url, width: uploaded.width, height: uploaded.height }),
      });
      const registered = await saved.json();
      if (!saved.ok) throw new Error(registered.error || 'Unable to add this image to the media library.');
      showMessage('Image uploaded.', 'success');
      return registered.media as Media;
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Image upload failed.', 'error');
      return null;
    }
  }

  featuredUpload.disabled = !uploadsReady;
  featuredUpload.addEventListener('click', async () => {
    const media = await uploadMedia();
    if (!media) return;
    featuredMedia = media;
    markDirty();
    renderFeaturedMedia();
  });

  root.querySelector<HTMLButtonElement>('#add-block')!.addEventListener('click', () => {
    content.blocks.push(defaultBlock(addType.value));
    markDirty();
    renderBlocks();
    blocksElement.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  const clientSlugify = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 200);
  slugInput.addEventListener('input', () => { slugInput.dataset.touched = 'true'; markDirty(); });
  titleInput.addEventListener('input', () => {
    if (slugInput.dataset.touched !== 'true') slugInput.value = clientSlugify(titleInput.value);
    markDirty();
  });
  root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('[data-post-field]').forEach((element) => element.addEventListener('input', markDirty));
  root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('[data-post-field]').forEach((element) => element.addEventListener('change', markDirty));

  function payload(status: 'draft' | 'scheduled' | 'published' | 'trashed') {
    return {
      title: titleInput.value,
      slug: slugInput.value,
      excerpt: field<HTMLTextAreaElement>('#post-excerpt').value,
      content,
      aeoSummary: field<HTMLTextAreaElement>('#post-aeo-summary').value,
      seoTitle: field<HTMLInputElement>('#post-seo-title').value,
      metaDescription: field<HTMLTextAreaElement>('#post-meta-description').value,
      canonicalUrl: field<HTMLInputElement>('#post-canonical-url').value,
      socialTitle: field<HTMLInputElement>('#post-social-title').value,
      socialDescription: field<HTMLTextAreaElement>('#post-social-description').value,
      noindex: field<HTMLInputElement>('#post-noindex').checked,
      status,
      scheduledFor: field<HTMLInputElement>('#post-scheduled-for').value,
      category: field<HTMLInputElement>('#post-category').value,
      tags: field<HTMLInputElement>('#post-tags').value.split(',').map((tag) => tag.trim()).filter(Boolean),
      featuredMediaId: featuredMedia?.id || null,
      featuredMediaAlt: featuredMedia?.altText || '',
      featuredMediaCaption: featuredMedia?.caption || '',
    };
  }

  async function save(status: 'draft' | 'scheduled' | 'published' | 'trashed') {
    if (busy) return;
    busy = true;
    root.querySelectorAll<HTMLButtonElement>('[data-save-post]').forEach((button) => { button.disabled = true; });
    showMessage(status === 'scheduled' ? 'Saving schedule…' : status === 'published' ? 'Publishing post…' : status === 'trashed' ? 'Moving to trash…' : 'Saving draft…');
    try {
      const response = await fetch(`/api/admin/posts/${encodeURIComponent(postId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify(payload(status)),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to save this post.');
      slugInput.value = result.post.slug || '';
      if (result.post.featuredMedia) featuredMedia = result.post.featuredMedia as Media;
      dirty = false;
      showMessage(status === 'scheduled' ? 'Scheduled for America/Denver time.' : status === 'published' ? 'Published publicly.' : status === 'trashed' ? 'Moved to trash.' : 'Draft saved privately.', 'success');
      if (status === 'trashed' || initialStatus === 'trashed') window.location.reload();
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Unable to save this post.', 'error');
    } finally {
      busy = false;
      root.querySelectorAll<HTMLButtonElement>('[data-save-post]').forEach((button) => { button.disabled = false; });
    }
  }

  window.addEventListener('beforeunload', (event) => {
    if (!dirty) return;
    event.preventDefault();
  });

  root.addEventListener('submit', (event) => event.preventDefault());
  root.querySelectorAll<HTMLButtonElement>('[data-save-post]').forEach((button) => button.addEventListener('click', () => {
    const status = button.dataset.savePost as 'draft' | 'scheduled' | 'published' | 'trashed';
    if (status === 'published' && !window.confirm('Publish this article publicly now?')) return;
    if (status === 'trashed' && !window.confirm('Move this article to trash? It will no longer be public.')) return;
    save(status);
  }));
  root.querySelector<HTMLAnchorElement>('#post-preview')!.addEventListener('click', (event) => {
    if (dirty) {
      event.preventDefault();
      showMessage('Save the draft before opening its private preview.', 'info');
    }
  });

  renderBlocks();
  renderFeaturedMedia();
}

// In-page confirmation dialog. Native confirm() is unreliable here: some embedded browsers dismiss
// it without showing anything, and a file picker opened after a slow answer loses the click's
// user activation. Resolving from the dialog's own button keeps that activation.

export interface AskOptions {
  title: string;
  /** Paragraphs of plain text. */
  body: string[];
  ok: string;
  danger?: boolean;
}

export function ask({ title, body, ok, danger }: AskOptions): Promise<boolean> {
  const dialog = document.createElement('dialog');
  dialog.className = 'ask';
  const h = document.createElement('h3');
  h.textContent = title;
  dialog.append(h);
  for (const text of body) {
    const p = document.createElement('p');
    p.textContent = text;
    dialog.append(p);
  }
  const actions = document.createElement('div');
  actions.className = 'actions';
  const cancel = document.createElement('button');
  cancel.className = 'btn';
  cancel.textContent = 'Cancel';
  const confirm = document.createElement('button');
  confirm.className = danger ? 'btn danger' : 'btn primary';
  confirm.textContent = ok;
  actions.append(cancel, confirm);
  dialog.append(actions);
  document.body.append(dialog);

  return new Promise((resolve) => {
    const done = (answer: boolean) => {
      dialog.close();
      dialog.remove();
      resolve(answer);
    };
    cancel.addEventListener('click', () => done(false));
    confirm.addEventListener('click', () => done(true));
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      done(false);
    });
    dialog.showModal();
    confirm.focus();
  });
}

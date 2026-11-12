// A searchable list of one kind of master record (ledgers, items):
// Enter alters the selected row, Alt+C creates, Alt+D deletes.
import { createList, toast, confirmBox } from './ui.js';
import { push } from './router.js';

export function masterList({ title, noun, columns, empty, load, form, remove }) {
  const list = createList({ filter: true, columns, empty, onEnter: (row) => push(form(row)) });
  const reload = async () => list.setRows(await load());

  async function removeCurrent() {
    const row = list.current();
    if (!row || !(await confirmBox(`Delete ${noun} "${row.name}"?`))) return;
    try {
      await remove(row);
      toast(`${row.name} deleted`);
      await reload();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  return {
    title,
    hints: [['Enter', 'Alter'], ['Alt+C', 'Create'], ['Alt+D', 'Delete'], ['Esc', 'Back']],
    el: list.el,
    async onShow() {
      await reload();
      list.focus();
    },
    onKey(event) {
      if (event.altKey && event.code === 'KeyC') push(form());
      else if (event.altKey && event.code === 'KeyD') removeCurrent();
      else return list.onKey(event);
      event.preventDefault();
      return true;
    },
  };
}

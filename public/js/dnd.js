// Board drag-and-drop on pointer events (mouse, pen and touch) with a keyboard alternative. Lanes say beforehand whether a drop is allowed,
// the card leaves a placeholder, the ghost follows the pointer, the board auto-scrolls near its edges, and every step is announced.
// The server still decides every transition: onDrop() must call the API and the caller refreshes from its answer (rollback = redraw).
const MOVE_PX = 6;

export function enableBoardDnD({
  board,
  laneSel = '.lane',
  cardSel = '.kcard',
  idOf = (c) => c.dataset.id,
  keyOf = (l) => l.dataset.key,
  labelOf = (l) => l.getAttribute('aria-label') || '',
  canDrop,
  onDrop,
  onDeny,
  announce = () => {},
  canDrag = () => true,
  reorder = false,
}) {
  const rtl = () => document.documentElement.dir === 'rtl';
  let st = null;
  let kb = null;
  let raf = 0;
  let lastX = 0;
  let lastY = 0;
  const lanes = () => [...board.querySelectorAll(laneSel)];
  const laneAt = (x, y) => document.elementFromPoint(x, y)?.closest?.(laneSel) || null;
  const mark = (lane, id, fromKey) => {
    lanes().forEach((l) => {
      l.classList.remove('over', 'deny');
      delete l.dataset.deny;
    });
    if (!lane) return null;
    const to = keyOf(lane);
    if (to === fromKey) {
      if (reorder) {
        lane.classList.add('over');
        return { ok: true, same: true };
      }
      return { ok: false, same: true };
    }
    const r = canDrop(to, id) || { ok: true };
    if (r.ok) lane.classList.add('over');
    else {
      lane.classList.add('deny');
      lane.dataset.deny = r.reason || 'غير مسموح';
    }
    return r;
  };
  // reorder boards also report where in the lane the card lands: the number of other cards whose centre is above the pointer
  const insIndex = (lane, y, skip) =>
    [...lane.querySelectorAll(cardSel)]
      .filter((c) => c !== skip && !c.classList.contains('dragging'))
      .filter((c) => {
        const r = c.getBoundingClientRect();
        return r.top + r.height / 2 < y;
      }).length;
  const clearIns = () =>
    board.querySelectorAll('.ins-before,.ins-end').forEach((e) => e.classList.remove('ins-before', 'ins-end'));
  const showIns = (lane, idx, skip) => {
    clearIns();
    if (!lane) return;
    const cs = [...lane.querySelectorAll(cardSel)].filter((c) => c !== skip && !c.classList.contains('dragging'));
    if (idx < cs.length) cs[idx].classList.add('ins-before');
    else lane.classList.add('ins-end');
  };
  const prepare = (id, fromKey) =>
    lanes().forEach((l) => {
      const k = keyOf(l);
      if (k === fromKey) {
        l.dataset.drop = 'same';
        return;
      }
      l.dataset.drop = (canDrop(k, id) || { ok: true }).ok ? 'ok' : 'deny';
    });
  const clearPrepare = () => {
    clearIns();
    lanes().forEach((l) => {
      delete l.dataset.drop;
      delete l.dataset.deny;
      l.classList.remove('over', 'deny');
    });
  };

  const scrollLoop = () => {
    if (!st?.active) return;
    const r = board.getBoundingClientRect();
    const edge = 70;
    let dx = 0;
    if (lastX < r.left + edge) dx = -16;
    else if (lastX > r.right - edge) dx = 16;
    if (dx) board.scrollLeft += dx;
    if (lastY < 90) window.scrollBy(0, -14);
    else if (lastY > innerHeight - 70) window.scrollBy(0, 14);
    raf = requestAnimationFrame(scrollLoop);
  };
  const place = (x, y) => {
    lastX = x;
    lastY = y;
    st.ghost.style.left = `${x - st.dx}px`;
    st.ghost.style.top = `${y - st.dy}px`;
  };
  const start = (e) => {
    const r = st.card.getBoundingClientRect();
    st.active = true;
    st.dx = st.x0 - r.left;
    st.dy = st.y0 - r.top;
    const g = st.card.cloneNode(true);
    g.removeAttribute('id');
    g.classList.add('ghost');
    g.setAttribute('aria-hidden', 'true');
    g.style.width = `${r.width}px`;
    g.tabIndex = -1;
    document.body.append(g);
    st.ghost = g;
    st.card.classList.add('dragging');
    board.classList.add('is-dragging');
    prepare(st.id, st.fromKey);
    announce(`بدأ سحب ${st.card.getAttribute('aria-label') || ''}`);
    place(e.clientX, e.clientY);
    raf = requestAnimationFrame(scrollLoop);
  };
  const finish = (drop, e) => {
    cancelAnimationFrame(raf);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey, true);
    const s = st;
    st = null;
    if (!s?.active) return;
    s.ghost.remove();
    s.card.classList.remove('dragging');
    board.classList.remove('is-dragging');
    const lane = drop && e ? laneAt(e.clientX, e.clientY) : null;
    const index = lane && reorder ? insIndex(lane, e.clientY, s.card) : undefined;
    clearPrepare();
    // a drag must not also "click" the card underneath
    const swallow = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    };
    s.card.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => s.card.removeEventListener('click', swallow, true), 60);
    if (!lane) {
      announce('أُلغي السحب');
      return;
    }
    const to = keyOf(lane);
    if (to === s.fromKey) {
      if (reorder) {
        announce('أُعيد ترتيب البطاقة');
        onDrop(to, s.id, { index, same: true });
      }
      return;
    }
    const r = canDrop(to, s.id) || { ok: true };
    if (!r.ok) {
      announce(r.reason || 'غير مسموح');
      onDeny?.(to, s.id, r);
      return;
    }
    announce(`نُقلت البطاقة إلى ${labelOf(lane)}`);
    onDrop(to, s.id, { index });
  };
  const onMove = (e) => {
    if (!st || e.pointerId !== st.pid) return;
    if (!st.active) {
      if (Math.hypot(e.clientX - st.x0, e.clientY - st.y0) < MOVE_PX) return;
      start(e);
    }
    e.preventDefault();
    place(e.clientX, e.clientY);
    const ln = laneAt(e.clientX, e.clientY);
    mark(ln, st.id, st.fromKey);
    if (reorder) showIns(ln, ln ? insIndex(ln, e.clientY, st.card) : 0, st.card);
  };
  const onUp = (e) => {
    if (st && e.pointerId === st.pid) finish(true, e);
  };
  const onCancel = () => finish(false);
  const onKey = (e) => {
    if (e.key === 'Escape' && st?.active) {
      e.stopPropagation();
      finish(false);
    }
  };

  board.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || st) return;
    const card = e.target.closest?.(cardSel);
    if (!card || !board.contains(card) || !canDrag(card)) return;
    if (e.target.closest('input,select,textarea')) return;
    // touch: only the grip starts a drag so the board can still be scrolled by swiping on the cards
    if (e.pointerType === 'touch' && !e.target.closest('.grip')) return;
    const lane = card.closest(laneSel);
    st = { card, id: idOf(card), fromKey: keyOf(lane), x0: e.clientX, y0: e.clientY, pid: e.pointerId, active: false };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
  });
  board.addEventListener('dragstart', (e) => {
    if (e.target.closest?.(cardSel)) e.preventDefault();
  }); // no native drag ghost on links/images

  // ---- keyboard: Space lifts, arrows choose the lane, Space/Enter drops, Esc cancels
  const kbTarget = () => lanes()[kb.i];
  const kbShow = () => {
    const l = kbTarget();
    const r = mark(l, kb.id, kb.fromKey);
    const name = labelOf(l);
    announce(
      kb.i === kb.from
        ? `${name} — العمود الحالي`
        : r?.ok
          ? `${name} — يمكن الإفلات هنا`
          : `${name} — ${r?.reason || 'غير مسموح'}`,
    );
    l.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  };
  const kbEnd = () => {
    if (!kb) return;
    kb.card.classList.remove('lifted');
    clearPrepare();
    kb = null;
  };
  board.addEventListener(
    'keydown',
    (e) => {
      const card = e.target.closest?.(cardSel);
      if (!card || e.ctrlKey || e.metaKey || e.altKey) return;
      if (!kb && e.key === ' ' && canDrag(card)) {
        e.preventDefault();
        const ls = lanes();
        const lane = card.closest(laneSel);
        const i = ls.indexOf(lane);
        kb = { card, id: idOf(card), fromKey: keyOf(lane), from: i, i, idx: null };
        card.classList.add('lifted');
        prepare(kb.id, kb.fromKey);
        announce(
          `رُفعت البطاقة ${card.getAttribute('aria-label') || ''}. السهمان يمينًا ويسارًا لاختيار العمود، المسطرة للإفلات، Esc للإلغاء`,
        );
        return;
      }
      if (!kb || kb.card !== card) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        kbEnd();
        announce('أُلغي النقل');
        card.focus();
        return;
      }
      if (reorder && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const lane = kbTarget();
        const cs = [...lane.querySelectorAll(cardSel)].filter((c) => c !== kb.card);
        const cur = kb.idx ?? (kb.i === kb.from ? [...lane.querySelectorAll(cardSel)].indexOf(kb.card) : cs.length);
        kb.idx = Math.max(0, Math.min(cs.length, cur + (e.key === 'ArrowDown' ? 1 : -1)));
        showIns(lane, kb.idx, kb.card);
        announce(`الموضع ${kb.idx + 1} من ${cs.length + 1} في ${labelOf(lane)}`);
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        kb.idx = null;
        e.preventDefault();
        const dirn = (e.key === 'ArrowRight' ? 1 : -1) * (rtl() ? -1 : 1);
        kb.i = Math.max(0, Math.min(lanes().length - 1, kb.i + dirn));
        kbShow();
        return;
      }
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const lane = kbTarget();
        const to = keyOf(lane);
        const id = kb.id;
        const same = to === kb.fromKey;
        const r = same ? { ok: reorder } : canDrop(to, id) || { ok: true };
        const idx = kb.idx;
        kbEnd();
        if (same && !reorder) {
          announce('لم يتغيّر العمود');
          return;
        }
        if (same && idx == null) {
          announce('لم يتغيّر الموضع');
          return;
        }
        if (!r.ok) {
          announce(r.reason || 'غير مسموح');
          onDeny?.(to, id, r);
          return;
        }
        announce(same ? 'أُعيد ترتيب البطاقة' : `نُقلت البطاقة إلى ${labelOf(lane)}`);
        onDrop(to, id, { index: idx ?? undefined, same });
      }
    },
    true,
  );
  board.addEventListener('focusout', (e) => {
    if (kb && !board.contains(e.relatedTarget)) {
      kbEnd();
    }
  });
}

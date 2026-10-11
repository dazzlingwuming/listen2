/* global angular */
/* eslint-disable no-param-reassign, no-loop-func */
// DOM insertion/transclusion callbacks below are synchronous.
// An element transclusion keeps the original row directives (drag/drop, menus,
// playback) and gives each occurrence its original index, including duplicates.
angular.module('listenone').directive('virtualRepeat', [
  '$window',
  ($window) => ({
    restrict: 'A',
    priority: 1000,
    terminal: true,
    transclude: 'element',
    link(scope, anchor, attrs, controller, transclude) {
      const match = attrs.virtualRepeat.match(/^\s*(\w+)\s+in\s+(.+)$/);
      if (!match) throw new Error('Invalid virtual-repeat expression');
      const rowHeight = Number(attrs.virtualRowHeight) || 64;
      const parent = anchor[0].parentNode;
      const top = document.createElement('li');
      const bottom = document.createElement('li');
      [top, bottom].forEach((node) => {
        node.className = 'virtual-spacer';
        node.setAttribute('aria-hidden', 'true');
      });
      parent.insertBefore(top, anchor[0].nextSibling);
      parent.insertBefore(bottom, top.nextSibling);
      let items = [];
      const blocks = new Map();
      let frame = null;
      let dead = false;
      let dragging = false;
      function viewport() {
        let node = parent;
        while (node && node !== document.body) {
          const style = $window.getComputedStyle(node);
          if (/(auto|scroll)/.test(style.overflowY)) {
            const rect = node.getBoundingClientRect();
            return { top: rect.top, height: node.clientHeight, node };
          }
          node = node.parentElement;
        }
        return {
          top: 0,
          height: $window.innerHeight,
          node: document.scrollingElement,
        };
      }
      function render() {
        if (dead || dragging) return;
        if (!parent.getClientRects().length) return;
        const view = viewport();
        const start = Math.max(
          0,
          Math.min(
            Math.max(0, items.length - 1),
            Math.floor(
              (view.top - top.getBoundingClientRect().top) / rowHeight
            ) - 6
          )
        );
        const end = Math.min(
          items.length,
          start + Math.ceil(view.height / rowHeight) + 12
        );
        blocks.forEach((block, index) => {
          if (
            index < start ||
            index >= end ||
            block.scope[match[1]] !== items[index]
          ) {
            block.scope.$destroy();
            block.clone.remove();
            blocks.delete(index);
          }
        });
        top.style.cssText = `height:${
          start * rowHeight
        }px!important;min-height:0!important;padding:0!important;margin:0!important;border:0!important;display:block!important;`;
        bottom.style.cssText = `height:${
          (items.length - end) * rowHeight
        }px!important;min-height:0!important;padding:0!important;margin:0!important;border:0!important;display:block!important;`;
        let previous = top;
        for (let index = start; index < end; index += 1) {
          let block = blocks.get(index);
          if (!block) {
            const child = scope.$new();
            child[match[1]] = items[index];
            child.$index = index;
            child.$first = index === 0;
            child.$last = index === items.length - 1;
            child.$middle = !child.$first && !child.$last;
            child.$odd = index % 2 === 1;
            child.$even = !child.$odd;
            transclude(child, (clone) => {
              block = { scope: child, clone };
              blocks.set(index, block);
              Array.from(clone).forEach((node) => {
                if (node.nodeType === 1) {
                  node.style.height = `${rowHeight}px`;
                  node.style.boxSizing = 'border-box';
                  node.style.marginTop = '0';
                  node.style.marginBottom = '0';
                  node.setAttribute('aria-posinset', index + 1);
                  node.setAttribute('aria-setsize', items.length);
                }
              });
            });
          }
          block.scope.$last = index === items.length - 1;
          Array.from(block.clone).forEach((node) => {
            if (previous.nextSibling !== node)
              parent.insertBefore(node, previous.nextSibling);
            previous = node;
          });
        }
      }
      function schedule() {
        if (frame !== null || dead) return;
        frame = $window.requestAnimationFrame(() => {
          frame = null;
          if (!dead) scope.$evalAsync(render);
        });
      }
      const unwatch = scope.$watchCollection(match[2], (value) => {
        items = value || [];
        schedule();
      });
      const observer = new $window.ResizeObserver(schedule);
      observer.observe(parent);
      $window.addEventListener('scroll', schedule, true);
      $window.addEventListener('resize', schedule);
      const startDrag = () => {
        dragging = true;
      };
      const endDrag = () => {
        dragging = false;
        schedule();
      };
      const scrollToIndex = (event) => {
        const index = Number(event.detail);
        if (!Number.isInteger(index) || index < 0 || index >= items.length)
          return;
        const view = viewport();
        view.node.scrollTop +=
          top.getBoundingClientRect().top -
          view.top +
          index * rowHeight -
          (view.height - rowHeight) / 2;
        schedule();
      };
      parent.addEventListener('listen2-scroll-index', scrollToIndex);
      parent.addEventListener('dragstart', startDrag);
      $window.addEventListener('dragend', endDrag);
      scope.$on('$destroy', () => {
        dead = true;
        unwatch();
        observer.disconnect();
        if (frame !== null) $window.cancelAnimationFrame(frame);
        $window.removeEventListener('scroll', schedule, true);
        $window.removeEventListener('resize', schedule);
        parent.removeEventListener('dragstart', startDrag);
        parent.removeEventListener('listen2-scroll-index', scrollToIndex);
        $window.removeEventListener('dragend', endDrag);
        blocks.forEach((block) => {
          block.scope.$destroy();
          block.clone.remove();
        });
        blocks.clear();
        top.remove();
        bottom.remove();
      });
    },
  }),
]);

'use client';

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

/**
 * 管理後台列表元件的兩個共用行為（2026-09-06）
 * ================================================
 * 兩個 hook 都是為了修同一類 bug 而存在，改動前請先讀完理由。
 */

/**
 * 讓本地列表狀態跟著伺服器回傳的 props 走。
 *
 * **為什麼不能只寫 `useState(initial)`**：`useState` 的初始值只在**掛載當下**取一次。
 * 篩選是 `router.push` 換查詢字串，RSC 會重新算並送來新的 props，但元件實例沒被重建，
 * 於是畫面停在舊清單 —— 症狀是「搜尋按了沒反應」，而網址列變了、伺服器也算對了，
 * 從畫面上完全看不出問題在前端。
 *
 * **為什麼不用 `key` 強制重建**：那是本次修正的第一版，會連搜尋框一起重建，
 * 於是每打一個字就失去焦點，得用滑鼠點回去才能繼續打。
 * 同步 props 而不重建，焦點與捲動位置都留得住。
 *
 * 仍保留一份本地狀態的理由：停權／下架等操作後要就地樂觀更新該列，不必整頁重新導覽。
 */
export function useSyncedList<T>(initial: T[]): [T[], Dispatch<SetStateAction<T[]>>] {
  const [items, setItems] = useState<T[]>(initial);
  const [prevInitial, setPrevInitial] = useState<T[]>(initial);

  /*
    渲染期間直接調整狀態，**不是**用 `useEffect` —— 這是 React 官方對
    「props 變了要重設 state」給的作法（Adjusting state when a prop changes）。
    寫成 effect 會多一次「先用舊資料畫一遍、再用新資料重畫」的閃爍，
    而且會被 `react-hooks/set-state-in-effect` 擋下。
    比較身分而非內容：`initial` 是伺服器每次回傳的新陣列，換頁必定換身分。
  */
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setItems(initial);
  }

  return [items, setItems];
}

/**
 * 把「邊打字邊搜尋」延後到停止輸入之後才真的導覽。
 *
 * **為什麼需要**：原本 `onChange` 直接 `router.push`，每打一個字就送一次伺服器請求，
 * 清單跟著閃一次。中文輸入更糟：注音組字過程中的每個中間狀態都會觸發一次搜尋。
 *
 * **延遲取 300ms**：低於 200ms 對中文輸入法的組字節奏來說仍會打斷，
 * 高於 500ms 使用者會覺得沒反應而重打。
 *
 * 回傳的函式在元件卸載時會取消尚未觸發的呼叫 —— 否則卸載後才觸發的 `router.push`
 * 會把使用者從他剛切過去的頁面拉回來。
 */
export function useDebouncedCallback<A extends unknown[]>(
  fn: (...args: A) => void,
  delayMs = 300
): (...args: A) => void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fnRef = useRef(fn);

  // 每次 render 更新，讓延遲觸發時取到的是最新的閉包（否則會用到舊的篩選值）
  useEffect(() => {
    fnRef.current = fn;
  });

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (...args: A) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => fnRef.current(...args), delayMs);
  };
}

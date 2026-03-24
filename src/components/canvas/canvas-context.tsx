'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react';

interface CanvasState {
  isOpen: boolean;
  html: string | null;
  title: string;
}

interface CanvasContextValue extends CanvasState {
  /** 캔버스를 열고 HTML을 표시 */
  openCanvas: (html: string, title?: string) => void;
  /** 캔버스 닫기 */
  closeCanvas: () => void;
}

const CanvasContext = createContext<CanvasContextValue | null>(null);

export function CanvasProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CanvasState>({
    isOpen: false,
    html: null,
    title: '',
  });

  const openCanvas = useCallback((html: string, title = 'Presentation') => {
    setState({ isOpen: true, html, title });
  }, []);

  const closeCanvas = useCallback(() => {
    setState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  return (
    <CanvasContext.Provider value={{ ...state, openCanvas, closeCanvas }}>
      {children}
    </CanvasContext.Provider>
  );
}

export function useCanvas() {
  const ctx = useContext(CanvasContext);
  if (!ctx) {
    throw new Error('useCanvas must be used within a CanvasProvider');
  }
  return ctx;
}

'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import {
  X,
  ExternalLink,
  Download,
  FileDown,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCanvas } from './canvas-context';

/**
 * iframe에 주입할 postMessage 브릿지 스크립트
 *
 * 부모 윈도우와 통신하여:
 * - 슬라이드 네비게이션 (navigate)
 * - 슬라이드 정보 전달 (slideInfo)
 * - PDF용 인쇄 (print)
 */
const BRIDGE_SCRIPT = `
<script data-bridge="mmiai">
(function() {
  // 슬라이드 변경 시 부모에 알림
  function notifySlideChange() {
    var slides = document.querySelectorAll('.slide');
    var current = 0;
    slides.forEach(function(s, i) {
      if (s.classList.contains('active')) current = i;
    });
    window.parent.postMessage({
      type: 'slideInfo',
      current: current,
      total: slides.length,
    }, '*');
  }

  // 기존 showSlide 함수를 래핑
  var origShowSlide = window.showSlide;
  if (origShowSlide) {
    window.showSlide = function(idx) {
      origShowSlide(idx);
      notifySlideChange();
    };
  }

  // 부모로부터 메시지 수신
  window.addEventListener('message', function(e) {
    if (!e.data || !e.data.type) return;

    if (e.data.type === 'navigate' && typeof e.data.slide === 'number') {
      if (window.showSlide) window.showSlide(e.data.slide);
    }

    if (e.data.type === 'getSlideInfo') {
      notifySlideChange();
    }

    if (e.data.type === 'print') {
      window.print();
    }
  });

  // 초기 슬라이드 정보 전달 (약간의 딜레이)
  setTimeout(notifySlideChange, 300);
})();
</script>
`;

/** 인쇄용 CSS — 모든 슬라이드를 페이지별로 표시 */
const PRINT_CSS = `
<style media="print">
  @page { size: landscape; margin: 0; }
  body { overflow: visible !important; }
  .slide-container { position: static !important; }
  .slide {
    display: flex !important;
    opacity: 1 !important;
    position: relative !important;
    page-break-after: always;
    break-after: page;
    height: 100vh;
    width: 100vw;
  }
  .slide-counter, .nav-hint, .nav-area { display: none !important; }
</style>
`;

/** HTML에 브릿지 스크립트와 인쇄 CSS를 주입 */
function injectBridge(html: string): string {
  // </body> 앞에 브릿지 스크립트 삽입
  if (html.includes('</body>')) {
    return html.replace('</body>', `${BRIDGE_SCRIPT}${PRINT_CSS}</body>`);
  }
  // </body>가 없으면 끝에 추가
  return html + BRIDGE_SCRIPT + PRINT_CSS;
}

/**
 * Canvas Panel
 *
 * Chat 옆에 열리는 사이드 패널.
 * 생성된 HTML 프레젠테이션을 iframe으로 렌더링한다.
 * 하단에 슬라이드 번호 네비게이션 바를 표시한다.
 */
export function CanvasPanel() {
  const { isOpen, html, title, closeCanvas } = useCanvas();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const blobUrlRef = useRef<string | null>(null);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [totalSlides, setTotalSlides] = useState(0);

  // iframe에서 슬라이드 정보 수신
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'slideInfo') {
        setCurrentSlide(e.data.current);
        setTotalSlides(e.data.total);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // HTML 로드 + 브릿지 주입
  useEffect(() => {
    if (!html) return;

    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
    }

    const injectedHtml = injectBridge(html);
    const blob = new Blob([injectedHtml], { type: 'text/html; charset=utf-8' });
    blobUrlRef.current = URL.createObjectURL(blob);

    if (iframeRef.current) {
      iframeRef.current.src = blobUrlRef.current;
    }

    // 슬라이드 상태 초기화
    setCurrentSlide(0);
    setTotalSlides(0);

    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [html]);

  const postToIframe = useCallback((message: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage(message, '*');
  }, []);

  const navigateSlide = useCallback(
    (index: number) => {
      postToIframe({ type: 'navigate', slide: index });
    },
    [postToIframe],
  );

  const handlePrev = useCallback(() => {
    if (currentSlide > 0) navigateSlide(currentSlide - 1);
  }, [currentSlide, navigateSlide]);

  const handleNext = useCallback(() => {
    if (currentSlide < totalSlides - 1) navigateSlide(currentSlide + 1);
  }, [currentSlide, totalSlides, navigateSlide]);

  const handlePrintPdf = useCallback(() => {
    postToIframe({ type: 'print' });
  }, [postToIframe]);

  const handleOpenNewTab = useCallback(() => {
    if (!html) return;
    const blob = new Blob([html], { type: 'text/html; charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, [html]);

  const handleDownload = useCallback(() => {
    if (!html) return;
    const blob = new Blob([html], { type: 'text/html; charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(title || 'presentation').replace(/[^a-zA-Z0-9가-힣\s]/g, '_')}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [html, title]);

  if (!isOpen) return null;

  return (
    <div className="flex h-full w-[55%] min-w-[400px] max-w-[800px] flex-col border-l border-border bg-background">
      {/* 헤더 */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex gap-1 shrink-0">
            <div className="size-2.5 rounded-full bg-red-400" />
            <div className="size-2.5 rounded-full bg-yellow-400" />
            <div className="size-2.5 rounded-full bg-green-400" />
          </div>
          <span className="text-sm font-medium truncate text-foreground">
            {title || 'Presentation'}
          </span>
          {totalSlides > 0 && (
            <span className="text-xs text-muted-foreground shrink-0">
              {currentSlide + 1} / {totalSlides}
            </span>
          )}
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          {html && (
            <>
              <button
                onClick={handlePrintPdf}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                title="PDF로 저장 (인쇄)"
              >
                <FileDown size={14} />
              </button>
              <button
                onClick={handleDownload}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                title="HTML 다운로드"
              >
                <Download size={14} />
              </button>
              <button
                onClick={handleOpenNewTab}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                title="새 탭에서 열기"
              >
                <ExternalLink size={14} />
              </button>
            </>
          )}
          <button
            onClick={closeCanvas}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            title="닫기"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* iframe */}
      <div className="flex-1 relative">
        {html ? (
          <iframe
            ref={iframeRef}
            className="size-full border-0 bg-white"
            sandbox="allow-scripts allow-same-origin allow-modals"
            title={title || 'Presentation Preview'}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            프레젠테이션이 여기에 표시됩니다
          </div>
        )}
      </div>

      {/* 슬라이드 네비게이션 바 */}
      {totalSlides > 0 && (
        <div className="flex items-center justify-center gap-1 border-t border-border px-4 py-2 bg-muted/30">
          <button
            onClick={handlePrev}
            disabled={currentSlide === 0}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft size={16} />
          </button>

          <div className="flex items-center gap-1 overflow-x-auto px-1">
            {Array.from({ length: totalSlides }, (_, i) => (
              <button
                key={i}
                onClick={() => navigateSlide(i)}
                className={cn(
                  'flex items-center justify-center rounded-md text-xs font-medium transition-colors min-w-[28px] h-7',
                  i === currentSlide
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                {i + 1}
              </button>
            ))}
          </div>

          <button
            onClick={handleNext}
            disabled={currentSlide === totalSlides - 1}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

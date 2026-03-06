import { existsSync, mkdirSync, createWriteStream, type WriteStream } from "node:fs";
import { join, dirname } from "node:path";
import { LoggerTransport } from "@mastra/core/logger";

export interface FilteredFileTransportOptions {
  /** 로그 디렉토리 경로 */
  dir: string;
  /** 제외할 메시지 패턴 (포함 시 로그 드롭) */
  excludePatterns?: (string | RegExp)[];
  /** JSON에서 제거할 필드 */
  omitFields?: string[];
  /** 파일명 접두사 (기본: "mastra") → mastra-2026-03-06.log */
  prefix?: string;
}

/**
 * 필터링 + KST 날짜별 로테이션 FileTransport
 *
 * - excludePatterns에 매칭되는 로그는 드롭
 * - omitFields에 지정된 필드는 JSON에서 제거
 * - KST 기준 날짜가 바뀌면 새 파일 생성
 */
export class FilteredFileTransport extends LoggerTransport {
  private dir: string;
  private prefix: string;
  private excludePatterns: (string | RegExp)[];
  private omitFields: string[];
  private currentDate: string = "";
  private fileStream: WriteStream | null = null;

  constructor(options: FilteredFileTransportOptions) {
    super({ objectMode: true });
    this.dir = options.dir;
    this.prefix = options.prefix ?? "mastra";
    this.excludePatterns = options.excludePatterns ?? [];
    this.omitFields = options.omitFields ?? [];

    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }
  }

  private getKSTDate(): string {
    const now = new Date();
    // KST = UTC+9
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    return kst.toISOString().slice(0, 10); // "2026-03-06"
  }

  private ensureStream(): WriteStream {
    const today = this.getKSTDate();
    if (this.currentDate !== today || !this.fileStream) {
      if (this.fileStream) {
        this.fileStream.end();
      }
      this.currentDate = today;
      const filePath = join(this.dir, `${this.prefix}-${today}.log`);
      this.fileStream = createWriteStream(filePath, { flags: "a" });
    }
    return this.fileStream;
  }

  private shouldExclude(msg: string): boolean {
    return this.excludePatterns.some((pattern) =>
      typeof pattern === "string" ? msg.includes(pattern) : pattern.test(msg),
    );
  }

  private formatEntry(raw: string): string | null {
    try {
      const obj = JSON.parse(raw);

      // 메시지 필터링
      const msg = obj.msg || "";
      if (this.shouldExclude(msg)) return null;

      // 필드 제거
      for (const field of this.omitFields) {
        delete obj[field];
      }

      // time을 KST ISO 문자열로 변환
      if (obj.time) {
        const kst = new Date(obj.time + 9 * 60 * 60 * 1000);
        obj.time = kst.toISOString().replace("Z", "+09:00");
      }

      return JSON.stringify(obj);
    } catch {
      // JSON 파싱 실패 시 원본 그대로 (non-JSON 로그)
      if (this.shouldExclude(raw)) return null;
      return raw;
    }
  }

  _transform(
    chunk: any,
    _encoding: string,
    callback: (error: Error | null, chunk: any) => void,
  ): void {
    try {
      const raw = typeof chunk === "string" ? chunk : chunk.toString();
      const lines = raw.split("\n").filter(Boolean);

      const stream = this.ensureStream();
      for (const line of lines) {
        const formatted = this.formatEntry(line);
        if (formatted !== null) {
          stream.write(formatted + "\n");
        }
      }
    } catch (error) {
      console.error("FilteredFileTransport error:", error);
    }
    callback(null, chunk);
  }

  _write(
    chunk: any,
    encoding?: string,
    callback?: (error?: Error | null) => void,
  ): boolean {
    if (typeof callback === "function") {
      this._transform(chunk, encoding || "utf8", callback);
      return true;
    }
    this._transform(chunk, encoding || "utf8", (error) => {
      if (error) console.error("FilteredFileTransport write error:", error);
    });
    return true;
  }

  _flush(callback: Function): void {
    if (this.fileStream) {
      this.fileStream.end(() => callback());
    } else {
      callback();
    }
  }

  _destroy(error: Error, callback: Function): void {
    if (this.fileStream) {
      this.fileStream.destroy(error);
    }
    callback(error);
  }
}

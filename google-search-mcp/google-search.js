// src/google-search.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// src/services/google-search.service.ts
import { google } from "googleapis";
import { URL as URL2 } from "url";
var GoogleSearchService = class {
  constructor() {
    // Cache for search results (key: query string + filters, value: results)
    this.searchCache = /* @__PURE__ */ new Map();
    // Cache expiration time in milliseconds (5 minutes)
    this.cacheTTL = 5 * 60 * 1e3;
    const apiKey = process.env.GOOGLE_API_KEY;
    const searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID;
    if (!apiKey || !searchEngineId) {
      throw new Error("Missing required environment variables: GOOGLE_API_KEY and GOOGLE_SEARCH_ENGINE_ID");
    }
    this.customSearch = google.customsearch("v1").cse;
    this.searchEngineId = searchEngineId;
    google.options({
      auth: apiKey
    });
  }
  /**
   * Generate a cache key from search parameters
   */
  generateCacheKey(query, numResults, filters) {
    return JSON.stringify({
      query,
      numResults,
      filters
    });
  }
  /**
   * Check if a cache entry is still valid
   */
  isCacheValid(entry) {
    const now = Date.now();
    return now - entry.timestamp < this.cacheTTL;
  }
  /**
   * Store search results in cache
   */
  cacheSearchResults(cacheKey, results, pagination, categories) {
    this.searchCache.set(cacheKey, {
      timestamp: Date.now(),
      data: { results, pagination, categories }
    });
    if (this.searchCache.size > 100) {
      const oldestKey = Array.from(this.searchCache.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp)[0][0];
      this.searchCache.delete(oldestKey);
    }
  }
  async search(query, numResults = 5, filters) {
    try {
      const cacheKey = this.generateCacheKey(query, numResults, filters);
      const cachedResult = this.searchCache.get(cacheKey);
      if (cachedResult && this.isCacheValid(cachedResult)) {
        console.error("Using cached search results");
        return cachedResult.data;
      }
      let formattedQuery = query;
      if (filters?.site) {
        formattedQuery += ` site:${filters.site}`;
      }
      if (filters?.exactTerms) {
        formattedQuery += ` "${filters.exactTerms}"`;
      }
      const page = filters?.page && filters.page > 0 ? filters.page : 1;
      const resultsPerPage = filters?.resultsPerPage ? Math.min(filters.resultsPerPage, 10) : Math.min(numResults, 10);
      const startIndex = (page - 1) * resultsPerPage + 1;
      const params = {
        cx: this.searchEngineId,
        q: formattedQuery,
        num: resultsPerPage,
        start: startIndex
      };
      if (filters?.language) {
        params.lr = `lang_${filters.language}`;
      }
      if (filters?.dateRestrict) {
        params.dateRestrict = filters.dateRestrict;
      }
      if (filters?.resultType) {
        switch (filters.resultType.toLowerCase()) {
          case "image":
          case "images":
            params.searchType = "image";
            break;
          case "news":
            formattedQuery += " source:news";
            params.q = formattedQuery;
            break;
          case "video":
          case "videos":
            formattedQuery += " filetype:video OR inurl:video OR inurl:watch";
            params.q = formattedQuery;
            break;
        }
      }
      if (filters?.sort) {
        switch (filters.sort.toLowerCase()) {
          case "date":
            params.sort = "date";
            break;
          case "relevance":
          default:
            break;
        }
      }
      const response = await this.customSearch.list(params);
      if (!response.data.items) {
        return {
          results: [],
          pagination: {
            currentPage: page,
            resultsPerPage,
            totalResults: 0,
            totalPages: 0,
            hasNextPage: false,
            hasPreviousPage: page > 1
          },
          categories: []
        };
      }
      const results = response.data.items.map((item) => {
        const result = {
          title: item.title || "",
          link: item.link || "",
          snippet: item.snippet || "",
          pagemap: item.pagemap || {},
          datePublished: item.pagemap?.metatags?.[0]?.["article:published_time"] || "",
          source: "google_search"
        };
        result.category = this.categorizeResult(result);
        return result;
      });
      const categories = this.generateCategoryStats(results);
      const totalResults = parseInt(response.data.searchInformation?.totalResults || "0", 10);
      const totalPages = Math.ceil(totalResults / resultsPerPage);
      const pagination = {
        currentPage: page,
        resultsPerPage,
        totalResults,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1
      };
      this.cacheSearchResults(cacheKey, results, pagination, categories);
      return {
        results,
        pagination,
        categories
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Google Search API error: ${error.message}`);
      }
      throw new Error("Unknown error during Google search");
    }
  }
  /**
   * Categorizes a search result based on its content
   * @param result The search result to categorize
   * @returns The category name
   */
  categorizeResult(result) {
    try {
      const url = new URL2(result.link);
      const domain = url.hostname.replace(/^www\./, "");
      if (domain.match(/facebook\.com|twitter\.com|instagram\.com|linkedin\.com|pinterest\.com|tiktok\.com|reddit\.com/i)) {
        return "Social Media";
      }
      if (domain.match(/youtube\.com|vimeo\.com|dailymotion\.com|twitch\.tv/i)) {
        return "Video";
      }
      if (domain.match(/news|cnn\.com|bbc\.com|nytimes\.com|wsj\.com|reuters\.com|bloomberg\.com/i)) {
        return "News";
      }
      if (domain.match(/\.edu$|wikipedia\.org|khan|course|learn|study|academic/i)) {
        return "Educational";
      }
      if (domain.match(/docs|documentation|developer|github\.com|gitlab\.com|bitbucket\.org|stackoverflow\.com/i) || result.title.match(/docs|documentation|api|reference|manual/i)) {
        return "Documentation";
      }
      if (domain.match(/amazon\.com|ebay\.com|etsy\.com|walmart\.com|shop|store|buy/i)) {
        return "Shopping";
      }
      return domain.split(".").slice(-2, -1)[0].charAt(0).toUpperCase() + domain.split(".").slice(-2, -1)[0].slice(1);
    } catch (error) {
      return "Other";
    }
  }
  /**
   * Generates category statistics from search results
   * @param results The search results to analyze
   * @returns An array of category information
   */
  generateCategoryStats(results) {
    const categoryCounts = {};
    results.forEach((result) => {
      const category = result.category || "Other";
      categoryCounts[category] = (categoryCounts[category] || 0) + 1;
    });
    return Object.entries(categoryCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }
};

// src/services/content-extractor.service.ts
import axios from "axios";
import * as cheerio from "cheerio";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
var ContentExtractor = class {
  constructor() {
    // Cache for webpage content (key: url + format, value: content)
    this.contentCache = /* @__PURE__ */ new Map();
    // Cache expiration time in milliseconds (30 minutes)
    this.cacheTTL = 30 * 60 * 1e3;
    this.turndownService = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced"
    });
  }
  cleanText(text) {
    text = text.replace(/\n\s*\n\s*\n/g, "\n\n");
    text = text.replace(/ +/g, " ");
    return text.trim();
  }
  cleanMarkdown(text) {
    let cleanedText = this.cleanText(text);
    cleanedText = cleanedText.replace(/#([A-Za-z0-9])/g, "# $1");
    return cleanedText;
  }
  htmlToMarkdown(html) {
    return this.cleanMarkdown(this.turndownService.turndown(html));
  }
  htmlToPlainText(html) {
    const dom = new JSDOM(html);
    return this.cleanText(dom.window.document.body.textContent || "");
  }
  isValidUrl(url) {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }
  /**
   * Generate a cache key from URL and format
   */
  generateCacheKey(url, format) {
    return `${url}|${format}`;
  }
  /**
   * Check if a cache entry is still valid
   */
  isCacheValid(entry) {
    const now = Date.now();
    return now - entry.timestamp < this.cacheTTL;
  }
  /**
   * Store webpage content in cache
   */
  cacheContent(url, format, content) {
    const cacheKey = this.generateCacheKey(url, format);
    this.contentCache.set(cacheKey, {
      timestamp: Date.now(),
      content
    });
    if (this.contentCache.size > 50) {
      const oldestKey = Array.from(this.contentCache.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp)[0][0];
      this.contentCache.delete(oldestKey);
    }
  }
  /**
   * Generates a concise summary of the content
   * @param content The content to summarize
   * @param maxLength Maximum length of the summary
   * @returns A summary of the content
   */
  generateSummary(content, maxLength = 300) {
    const sentences = content.split(/(?<=[.!?])\s+/);
    let summary = "";
    for (const sentence of sentences) {
      if ((summary + sentence).length <= maxLength) {
        summary += sentence + " ";
      } else {
        break;
      }
    }
    return summary.trim() + (summary.length < content.length ? "..." : "");
  }
  async extractContent(url, format = "markdown") {
    if (!this.isValidUrl(url)) {
      throw new Error("Invalid URL provided");
    }
    const cacheKey = this.generateCacheKey(url, format);
    const cachedContent = this.contentCache.get(cacheKey);
    if (cachedContent && this.isCacheValid(cachedContent)) {
      console.error(`Using cached content for ${url}`);
      return cachedContent.content;
    }
    try {
      const response = await axios.get(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
          "Accept-Encoding": "gzip, deflate, br",
          "Cache-Control": "no-cache",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
          "Sec-Fetch-User": "?1",
          "Upgrade-Insecure-Requests": "1"
        },
        timeout: 15000,
        maxRedirects: 5
      });
      const $ = cheerio.load(response.data);
      const metaTags = {};
      const importantMetaTags = ["description", "keywords", "author", "og:title", "og:description", "twitter:title", "twitter:description"];
      $("meta").each((_, element) => {
        const name = $(element).attr("name") || $(element).attr("property") || "";
        const content2 = $(element).attr("content") || "";
        if (name && content2 && importantMetaTags.some((tag) => name.includes(tag))) {
          metaTags[name] = content2;
        }
      });
      const dom = new JSDOM(response.data);
      const reader = new Readability(dom.window.document);
      const article = reader.parse();
      if (!article) {
        throw new Error("Failed to extract content from webpage");
      }
      let contentStr;
      switch (format) {
        case "html":
          contentStr = article.content || "";
          break;
        case "text":
          contentStr = this.htmlToPlainText(article.content || "");
          break;
        case "markdown":
        default:
          contentStr = this.htmlToMarkdown(article.content || "");
          break;
      }
      const wordCount = contentStr.split(/\s+/).filter((word) => word.length > 0).length;
      const summary = this.generateSummary(contentStr);
      const content = {
        url,
        title: $("title").text() || article.title || "",
        description: metaTags["description"] || "",
        content: contentStr,
        format,
        meta_tags: metaTags,
        stats: {
          word_count: wordCount,
          approximate_chars: contentStr.length
        },
        content_preview: {
          first_500_chars: contentStr.slice(0, 500) + (contentStr.length > 500 ? "..." : "")
        },
        summary
      };
      this.cacheContent(url, format, content);
      return content;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Failed to fetch webpage: ${error.message}`);
      }
      throw error;
    }
  }
  async batchExtractContent(urls, format = "markdown") {
    const results = {};
    await Promise.all(
      urls.map(async (url) => {
        try {
          results[url] = await this.extractContent(url, format);
        } catch (error) {
          results[url] = {
            error: error instanceof Error ? error.message : "Unknown error occurred"
          };
        }
      })
    );
    return results;
  }
};

// src/google-search.ts
var GoogleSearchServer = class {
  constructor() {
    this.searchService = new GoogleSearchService();
    this.contentExtractor = new ContentExtractor();
    this.server = new Server(
      {
        name: "google-search",
        version: "1.0.0"
      },
      {
        capabilities: {
          tools: {
            google_search: {
              description: "Search Google and return relevant results from the web. This tool finds web pages, articles, and information on specific topics using Google's search engine. Results include titles, snippets, and URLs that can be analyzed further using extract_webpage_content.",
              inputSchema: {
                type: "object",
                properties: {
                  query: {
                    type: "string",
                    description: "Search query - be specific and use quotes for exact matches. For best results, use clear keywords and avoid very long queries."
                  },
                  num_results: {
                    type: "number",
                    description: "Number of results to return (default: 5, max: 10). Increase for broader coverage, decrease for faster response."
                  },
                  site: {
                    type: "string",
                    description: 'Limit search results to a specific website domain (e.g., "wikipedia.org" or "nytimes.com").'
                  },
                  language: {
                    type: "string",
                    description: 'Filter results by language using ISO 639-1 codes (e.g., "en" for English, "es" for Spanish, "fr" for French).'
                  },
                  dateRestrict: {
                    type: "string",
                    description: `Filter results by date using Google's date restriction format: "d[number]" for past days, "w[number]" for past weeks, "m[number]" for past months, or "y[number]" for past years. Example: "m6" for results from the past 6 months.`
                  },
                  exactTerms: {
                    type: "string",
                    description: "Search for results that contain this exact phrase. This is equivalent to putting the terms in quotes in the search query."
                  },
                  resultType: {
                    type: "string",
                    description: 'Specify the type of results to return. Options include "image" (or "images"), "news", and "video" (or "videos"). Default is general web results.'
                  },
                  page: {
                    type: "number",
                    description: "Page number for paginated results (starts at 1). Use in combination with resultsPerPage to navigate through large result sets."
                  },
                  resultsPerPage: {
                    type: "number",
                    description: "Number of results to show per page (default: 5, max: 10). Controls how many results are returned for each page."
                  },
                  sort: {
                    type: "string",
                    description: 'Sorting method for search results. Options: "relevance" (default) or "date" (most recent first).'
                  }
                },
                required: ["query"]
              }
            },
            extract_webpage_content: {
              description: "Extract and analyze content from a webpage, converting it to readable text. This tool fetches the main content while removing ads, navigation elements, and other clutter. Use it to get detailed information from specific pages found via google_search. Works with most common webpage formats including articles, blogs, and documentation.",
              inputSchema: {
                type: "object",
                properties: {
                  url: {
                    type: "string",
                    description: "Full URL of the webpage to extract content from (must start with http:// or https://). Ensure the URL is from a public webpage and not behind authentication."
                  },
                  format: {
                    type: "string",
                    description: 'Output format for the extracted content. Options: "markdown" (default), "html", or "text".'
                  }
                },
                required: ["url"]
              }
            },
            extract_multiple_webpages: {
              description: "Extract and analyze content from multiple webpages in a single request. This tool is ideal for comparing information across different sources or gathering comprehensive information on a topic. Limited to 5 URLs per request to maintain performance.",
              inputSchema: {
                type: "object",
                properties: {
                  urls: {
                    type: "array",
                    items: { type: "string" },
                    description: "Array of webpage URLs to extract content from. Each URL must be public and start with http:// or https://. Maximum 5 URLs per request."
                  },
                  format: {
                    type: "string",
                    description: 'Output format for the extracted content. Options: "markdown" (default), "html", or "text".'
                  }
                },
                required: ["urls"]
              }
            }
          }
        }
      }
    );
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "google_search",
          description: "Search Google and return relevant results from the web. This tool finds web pages, articles, and information on specific topics using Google's search engine. Results include titles, snippets, and URLs that can be analyzed further using extract_webpage_content.",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Search query - be specific and use quotes for exact matches. For best results, use clear keywords and avoid very long queries."
              },
              num_results: {
                type: "number",
                description: "Number of results to return (default: 5, max: 10). Increase for broader coverage, decrease for faster response."
              },
              site: {
                type: "string",
                description: 'Limit search results to a specific website domain (e.g., "wikipedia.org" or "nytimes.com").'
              },
              language: {
                type: "string",
                description: 'Filter results by language using ISO 639-1 codes (e.g., "en" for English, "es" for Spanish, "fr" for French).'
              },
              dateRestrict: {
                type: "string",
                description: `Filter results by date using Google's date restriction format: "d[number]" for past days, "w[number]" for past weeks, "m[number]" for past months, or "y[number]" for past years. Example: "m6" for results from the past 6 months.`
              },
              exactTerms: {
                type: "string",
                description: "Search for results that contain this exact phrase. This is equivalent to putting the terms in quotes in the search query."
              },
              resultType: {
                type: "string",
                description: 'Specify the type of results to return. Options include "image" (or "images"), "news", and "video" (or "videos"). Default is general web results.'
              },
              page: {
                type: "number",
                description: "Page number for paginated results (starts at 1). Use in combination with resultsPerPage to navigate through large result sets."
              },
              resultsPerPage: {
                type: "number",
                description: "Number of results to show per page (default: 5, max: 10). Controls how many results are returned for each page."
              },
              sort: {
                type: "string",
                description: 'Sorting method for search results. Options: "relevance" (default) or "date" (most recent first).'
              }
            },
            required: ["query"]
          }
        },
        {
          name: "extract_webpage_content",
          description: "Extract and analyze content from a webpage, converting it to readable text. This tool fetches the main content while removing ads, navigation elements, and other clutter. Use it to get detailed information from specific pages found via google_search. Works with most common webpage formats including articles, blogs, and documentation.",
          inputSchema: {
            type: "object",
            properties: {
              url: {
                type: "string",
                description: "Full URL of the webpage to extract content from (must start with http:// or https://). Ensure the URL is from a public webpage and not behind authentication."
              },
              format: {
                type: "string",
                description: 'Output format for the extracted content. Options: "markdown" (default), "html", or "text".'
              }
            },
            required: ["url"]
          }
        },
        {
          name: "extract_multiple_webpages",
          description: "Extract and analyze content from multiple webpages in a single request. This tool is ideal for comparing information across different sources or gathering comprehensive information on a topic. Limited to 5 URLs per request to maintain performance.",
          inputSchema: {
            type: "object",
            properties: {
              urls: {
                type: "array",
                items: { type: "string" },
                description: "Array of webpage URLs to extract content from. Each URL must be public and start with http:// or https://. Maximum 5 URLs per request."
              },
              format: {
                type: "string",
                description: 'Output format for the extracted content. Options: "markdown" (default), "html", or "text".'
              }
            },
            required: ["urls"]
          }
        }
      ]
    }));
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      switch (request.params.name) {
        case "google_search":
          if (typeof request.params.arguments === "object" && request.params.arguments !== null && "query" in request.params.arguments) {
            return this.handleSearch({
              query: String(request.params.arguments.query),
              num_results: typeof request.params.arguments.num_results === "number" ? request.params.arguments.num_results : void 0,
              filters: {
                site: request.params.arguments.site ? String(request.params.arguments.site) : void 0,
                language: request.params.arguments.language ? String(request.params.arguments.language) : void 0,
                dateRestrict: request.params.arguments.dateRestrict ? String(request.params.arguments.dateRestrict) : void 0,
                exactTerms: request.params.arguments.exactTerms ? String(request.params.arguments.exactTerms) : void 0,
                resultType: request.params.arguments.resultType ? String(request.params.arguments.resultType) : void 0,
                page: typeof request.params.arguments.page === "number" ? request.params.arguments.page : void 0,
                resultsPerPage: typeof request.params.arguments.resultsPerPage === "number" ? request.params.arguments.resultsPerPage : void 0,
                sort: request.params.arguments.sort ? String(request.params.arguments.sort) : void 0
              }
            });
          }
          throw new Error("Invalid arguments for google_search tool");
        case "extract_webpage_content":
          if (typeof request.params.arguments === "object" && request.params.arguments !== null && "url" in request.params.arguments) {
            return this.handleAnalyzeWebpage({
              url: String(request.params.arguments.url),
              format: request.params.arguments.format ? String(request.params.arguments.format) : "markdown"
            });
          }
          throw new Error("Invalid arguments for extract_webpage_content tool");
        case "extract_multiple_webpages":
          if (typeof request.params.arguments === "object" && request.params.arguments !== null && "urls" in request.params.arguments && Array.isArray(request.params.arguments.urls)) {
            return this.handleBatchAnalyzeWebpages({
              urls: request.params.arguments.urls.map(String),
              format: request.params.arguments.format ? String(request.params.arguments.format) : "markdown"
            });
          }
          throw new Error("Invalid arguments for extract_multiple_webpages tool");
        default:
          throw new Error(`Unknown tool: ${request.params.name}`);
      }
    });
  }
  async handleSearch(args) {
    try {
      const { results, pagination, categories } = await this.searchService.search(args.query, args.num_results, args.filters);
      if (results.length === 0) {
        return {
          content: [{
            type: "text",
            text: "No results found. Try:\n- Using different keywords\n- Removing quotes from non-exact phrases\n- Using more general terms"
          }],
          isError: true
        };
      }
      const formattedResults = results.map((result) => ({
        title: result.title,
        link: result.link,
        snippet: result.snippet,
        category: result.category
      }));
      let responseText = `Search results for "${args.query}":

`;
      if (categories && categories.length > 0) {
        responseText += "Categories: " + categories.map((c) => `${c.name} (${c.count})`).join(", ") + "\n\n";
      }
      if (pagination) {
        responseText += `Showing page ${pagination.currentPage}${pagination.totalResults ? ` of approximately ${pagination.totalResults} results` : ""}

`;
      }
      formattedResults.forEach((result, index) => {
        responseText += `${index + 1}. ${result.title}
`;
        responseText += `   URL: ${result.link}
`;
        responseText += `   ${result.snippet}

`;
      });
      if (pagination && (pagination.hasNextPage || pagination.hasPreviousPage)) {
        responseText += "Navigation: ";
        if (pagination.hasPreviousPage) {
          responseText += "Use 'page: " + (pagination.currentPage - 1) + "' for previous results. ";
        }
        if (pagination.hasNextPage) {
          responseText += "Use 'page: " + (pagination.currentPage + 1) + "' for more results.";
        }
        responseText += "\n";
      }
      return {
        content: [
          {
            type: "text",
            text: responseText
          }
        ]
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error during search";
      return {
        content: [{ type: "text", text: message }],
        isError: true
      };
    }
  }
  async handleAnalyzeWebpage(args) {
    try {
      const content = await this.contentExtractor.extractContent(args.url, args.format);
      let responseText = `Content from: ${content.url}

`;
      responseText += `Title: ${content.title}
`;
      if (content.description) {
        responseText += `Description: ${content.description}
`;
      }
      responseText += `
Stats: ${content.stats.word_count} words, ${content.stats.approximate_chars} characters

`;
      if (content.summary) {
        responseText += `Summary: ${content.summary}

`;
      }
      responseText += `Content Preview:
${content.content_preview.first_500_chars}

`;
      responseText += `Note: This is a preview of the content. For specific information, please ask about particular aspects of this webpage.`;
      return {
        content: [
          {
            type: "text",
            text: responseText
          }
        ]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      const helpText = "Common issues:\n- Check if the URL is accessible in a browser\n- Ensure the webpage is public\n- Try again if it's a temporary network issue";
      return {
        content: [
          {
            type: "text",
            text: `${errorMessage}

${helpText}`
          }
        ],
        isError: true
      };
    }
  }
  async handleBatchAnalyzeWebpages(args) {
    if (args.urls.length > 5) {
      return {
        content: [{
          type: "text",
          text: "Maximum 5 URLs allowed per request to maintain performance. Please reduce the number of URLs."
        }],
        isError: true
      };
    }
    try {
      const results = await this.contentExtractor.batchExtractContent(args.urls, args.format);
      let responseText = `Content from ${args.urls.length} webpages:

`;
      for (const [url, result] of Object.entries(results)) {
        responseText += `URL: ${url}
`;
        if ("error" in result) {
          responseText += `Error: ${result.error}

`;
          continue;
        }
        responseText += `Title: ${result.title}
`;
        if (result.description) {
          responseText += `Description: ${result.description}
`;
        }
        responseText += `Stats: ${result.stats.word_count} words
`;
        if (result.summary) {
          responseText += `Summary: ${result.summary}
`;
        }
        responseText += `Preview: ${result.content_preview.first_500_chars.substring(0, 150)}...

`;
      }
      responseText += `Note: These are previews of the content. To analyze the full content of a specific URL, use the extract_webpage_content tool with that URL.`;
      return {
        content: [
          {
            type: "text",
            text: responseText
          }
        ]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      const helpText = "Common issues:\n- Check if all URLs are accessible in a browser\n- Ensure all webpages are public\n- Try again if it's a temporary network issue\n- Consider reducing the number of URLs";
      return {
        content: [
          {
            type: "text",
            text: `${errorMessage}

${helpText}`
          }
        ],
        isError: true
      };
    }
  }
  async start() {
    try {
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      console.error("Google Search MCP server running");
      process.on("SIGINT", () => {
        this.server.close().catch(console.error);
        process.exit(0);
      });
    } catch (error) {
      if (error instanceof Error) {
        console.error("Failed to start MCP server:", error.message);
      } else {
        console.error("Failed to start MCP server: Unknown error");
      }
      process.exit(1);
    }
  }
};
var server = new GoogleSearchServer();
server.start().catch(console.error);

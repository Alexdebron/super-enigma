const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
const BASE_URL = "https://cartoons.lk";

// Request headers to avoid being blocked
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,si;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  Connection: "keep-alive",
  "Cache-Control": "max-age=0",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
  Referer: "https://cartoons.lk/",
};

// CORS middleware
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// Axios instance with default headers
const client = axios.create({
  headers: HEADERS,
  timeout: 15000,
});

// Search movies/series by keyword
app.get("/api/search", async (req, res) => {
  const { q } = req.query;

  if (!q) {
    return res.status(400).json({
      status: "error",
      message: "Please provide a search query. Usage: /api/search?q=movie_name",
    });
  }

  try {
    const { data } = await client.get(
      `${BASE_URL}/?s=${encodeURIComponent(q)}`
    );
    const $ = cheerio.load(data);

    const results = [];

    // Search results - articles with h2 titles
    $("article, .post, .entry").each((i, el) => {
      const titleTag = $(el).find("h2 a, .entry-title a").first();
      const title = titleTag.text().trim();
      const link = titleTag.attr("href") || "";
      const imgEl = $(el).find("img").first();
      const image = imgEl.attr("data-src") || imgEl.attr("data-lazy-src") || imgEl.attr("src") || "";
      const finalImage = image && !image.startsWith("data:") ? image : "";
      const excerpt = $(el).find("p, .entry-summary").first().text().trim();
      const date = $(el).find("time, .date, .entry-date").first().text().trim();
      const category =
        $(el).find("a[href*='/category/']").first().text().trim() || "";

      if (title && link) {
        results.push({
          title,
          link,
          image: finalImage || undefined,
          excerpt: excerpt || undefined,
          date: date || undefined,
          category: category || undefined,
        });
      }
    });

    // Fallback: find h2 > a links
    if (results.length === 0) {
      $("h2 a").each((i, el) => {
        const title = $(el).text().trim();
        const link = $(el).attr("href") || "";
        if (title && link && link.includes("cartoons.lk/")) {
          results.push({ title, link });
        }
      });
    }

    if (results.length === 0) {
      return res.json({
        status: "success",
        message: "No results found for your search query.",
        query: q,
        results: [],
      });
    }

    res.json({
      status: "success",
      query: q,
      count: results.length,
      results,
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: `Failed to search: ${error.message}`,
    });
  }
});

// Get movie/series details and download links
app.get("/api/movie", async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({
      status: "error",
      message:
        "Please provide a movie URL. Usage: /api/movie?url=https://cartoons.lk/movie-slug/",
    });
  }

  try {
    const { data } = await client.get(url);
    const $ = cheerio.load(data);

    // Extract title
    const title = $("h1").first().text().trim();

    // Extract breadcrumb category
    const category =
      $("a[href*='/category/']").first().text().trim() || "";

    // Extract date
    const date = $("time, .date, .entry-date, .post-date").first().text().trim();

    // Extract views
    let views = "";
    const bodyText = $("body").text();
    const viewsMatch = bodyText.match(/([\d,]+)\s*Views/i);
    if (viewsMatch) views = viewsMatch[1];

    // Extract description/content
    let description = "";
    const contentParagraphs = [];
    $(".entry-content p, article p, .post-content p").each((i, el) => {
      const text = $(el).text().trim();
      if (
        text &&
        text.length > 10 &&
        !text.includes("click") &&
        !text.includes("redirect") &&
        !text.includes("Join Our")
      ) {
        contentParagraphs.push(text);
      }
    });
    description = contentParagraphs.join("\n\n");

    // Extract quality and size info from h3 or content
    let qualityInfo = "";
    $("h3").each((i, el) => {
      const text = $(el).text().trim();
      if (text.includes("p |") || text.includes("GB") || text.includes("MB")) {
        qualityInfo = text;
      }
    });

    // Extract poster/thumbnail (handle lazy loading)
    let poster = "";
    $(".entry-content img, article img, .post-thumbnail img").each((i, el) => {
      if (poster) return;
      const src = $(el).attr("data-src") || $(el).attr("data-lazy-src") || $(el).attr("src") || "";
      if (src && !src.startsWith("data:")) {
        poster = src;
      }
    });

    // Extract download links
    const downloadLinks = [];
    $("a").each((i, el) => {
      const href = $(el).attr("href") || "";
      const text = $(el).text().trim();

      if (
        text.toLowerCase().includes("download") &&
        !text.toLowerCase().includes("telegram")
      ) {
        downloadLinks.push({
          label: text,
          url: href,
          type: "download",
        });
      } else if (text.toLowerCase().includes("watch online")) {
        downloadLinks.push({
          label: text,
          url: href,
          type: "watch_online",
        });
      }
    });

    // Also look for buttons/links with specific classes
    $("a.btn, a.button, a.download-btn, .download-link a, .btn-download").each(
      (i, el) => {
        const href = $(el).attr("href") || "";
        const text = $(el).text().trim();
        if (href && !downloadLinks.find((d) => d.url === href)) {
          downloadLinks.push({
            label: text || "Download",
            url: href,
            type: href.includes("watch") ? "watch_online" : "download",
          });
        }
      }
    );

    // Extract Telegram channel link
    let telegramChannel = "";
    $("a[href*='t.me']").each((i, el) => {
      const href = $(el).attr("href") || "";
      if (href.includes("t.me")) {
        telegramChannel = href;
      }
    });

    // Extract tags
    const tags = [];
    $("a[href*='/tag/']").each((i, el) => {
      tags.push($(el).text().trim());
    });

    // Extract related/navigation
    const related = [];
    $("a[href*='cartoons.lk/']").each((i, el) => {
      const href = $(el).attr("href");
      const relText = $(el).text().trim();
      if (
        href &&
        relText &&
        relText.length > 5 &&
        !href.includes("/category/") &&
        !href.includes("/tag/") &&
        href !== url &&
        href !== BASE_URL + "/" &&
        !related.find((r) => r.link === href)
      ) {
        // Only include movie/series pages
        if (
          href.includes("-dubbed") ||
          href.includes("-sinhala") ||
          href.includes("-movie") ||
          href.includes("-cartoon")
        ) {
          related.push({ title: relText, link: href });
        }
      }
    });

    res.json({
      status: "success",
      movie: {
        title,
        poster,
        category: category || undefined,
        date: date || undefined,
        views: views || undefined,
        quality_info: qualityInfo || undefined,
        description: description || undefined,
        tags: tags.length > 0 ? tags : undefined,
        telegram_channel: telegramChannel || undefined,
        download_links: downloadLinks,
        related: related.length > 0 ? related.slice(0, 5) : undefined,
      },
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: `Failed to get movie details: ${error.message}`,
    });
  }
});

// Get latest movies
app.get("/api/latest", async (req, res) => {
  const page = req.query.page || 1;
  const category = req.query.category || "movies"; // movies or cartoon-series

  try {
    const url =
      page > 1
        ? `${BASE_URL}/category/${category}/page/${page}/`
        : `${BASE_URL}/category/${category}/`;

    const { data } = await client.get(url);
    const $ = cheerio.load(data);

    const movies = [];

    $("article, .post, .entry").each((i, el) => {
      const titleTag = $(el).find("h2 a, .entry-title a").first();
      const title = titleTag.text().trim();
      const link = titleTag.attr("href") || "";
      const imgEl2 = $(el).find("img").first();
      const image = imgEl2.attr("data-src") || imgEl2.attr("data-lazy-src") || imgEl2.attr("src") || "";
      const finalImg = image && !image.startsWith("data:") ? image : "";
      const excerpt = $(el).find("p, .entry-summary").first().text().trim();
      const date = $(el).find("time, .date").first().text().trim();

      if (title && link) {
        movies.push({
          title,
          link,
          image: finalImg || undefined,
          excerpt: excerpt || undefined,
          date: date || undefined,
        });
      }
    });

    // Fallback
    if (movies.length === 0) {
      $("h2 a").each((i, el) => {
        const title = $(el).text().trim();
        const link = $(el).attr("href") || "";
        if (title && link && link.includes("cartoons.lk/")) {
          movies.push({ title, link });
        }
      });
    }

    // Check for pagination
    let totalPages = 1;
    const pageLinks = $("a[href*='/page/']");
    pageLinks.each((i, el) => {
      const href = $(el).attr("href") || "";
      const pageMatch = href.match(/\/page\/(\d+)/);
      if (pageMatch) {
        const p = parseInt(pageMatch[1]);
        if (p > totalPages) totalPages = p;
      }
    });

    res.json({
      status: "success",
      category,
      page: parseInt(page),
      total_pages: totalPages,
      count: movies.length,
      movies,
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: `Failed to fetch latest: ${error.message}`,
    });
  }
});

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    message: "Cartoons.lk Scraper API",
    version: "1.0",
    headers_info: "Browser-like headers included to avoid blocking",
    cors: "Enabled for all origins",
    endpoints: {
      search: "GET /api/search?q=movie_name - Search for movies/series",
      movie_details:
        "GET /api/movie?url=https://cartoons.lk/movie-slug/ - Get movie details & download links",
      latest:
        "GET /api/latest?category=movies&page=1 - Get latest movies (categories: movies, cartoon-series)",
    },
    examples: {
      search: "/api/search?q=dragon",
      movie: "/api/movie?url=https://cartoons.lk/kung-fu-panda-sinhala-dubbed-movie/",
      latest_movies: "/api/latest?category=movies",
      latest_series: "/api/latest?category=cartoon-series",
      latest_page2: "/api/latest?category=movies&page=2",
    },
  });
});


app.get("/", (req, res) => {
  res.json({
    success: true,
    creator: "WhiteShadow",
    api: "Cartoons.lk Scraper API"
  });
});

module.exports = app;

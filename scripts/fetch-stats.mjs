// scripts/fetch-stats.mjs
//
// Language charts: selected MERN/full-stack repositories only.
// Overall GitHub stats: all public, non-fork repositories.
// Both language charts use the same language distribution.

import fs from "node:fs/promises";

const USERNAME = process.env.GITHUB_USERNAME;
const TOKEN = process.env.GITHUB_TOKEN;

if (!USERNAME || !TOKEN) {
  console.error("Missing GITHUB_USERNAME or GITHUB_TOKEN env vars.");
  process.exit(1);
}

const API = "https://api.github.com";
const GRAPHQL_API = "https://api.github.com/graphql";

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

const MAX_LANGUAGE_ROWS = 5;

// Only these repositories contribute to the language charts.
const LANGUAGE_REPOS = new Set([
  "BookMe",
  "Agri_Care",
  "CodeSphere",
  "Study-Notion",
  "LangGrap_proj",
  "candidate-data-transformer",
  "Phishing_Detection",
  "docker-compose",
  "TS",
  "Music_Player",
  "Dockerfile_node",
  "GENAI",
]);

const MAX_LANGUAGE_BYTES = 5;

const TELEMETRY_TARGETS = [
  {
    template: "assets/templates/telemetry-light.template.svg",
    output: "assets/telemetry.svg",
  },
  {
    template: "assets/templates/telemetry-dark.template.svg",
    output: "assets/dark/telemetry.svg",
  },
];

const GITHUB_STATS_TARGETS = [
  {
    template: "assets/templates/github-stats-light.template.svg",
    output: "assets/github-stats.svg",
  },
  {
    template: "assets/templates/github-stats-dark.template.svg",
    output: "assets/dark/github-stats.svg",
  },
];

const CONTRIBUTION_TARGETS = [
  {
    template: "assets/templates/contribution-graph-light.template.svg",
    output: "assets/contribution-graph.svg",
  },
  {
    template: "assets/templates/contribution-graph-dark.template.svg",
    output: "assets/dark/contribution-graph.svg",
  },
];

// ---------- REST: repositories and languages ----------

async function getAllRepos() {
  const repos = [];
  let page = 1;

  while (true) {
    const res = await fetch(
      `${API}/users/${USERNAME}/repos?per_page=100&page=${page}&type=owner`,
      { headers }
    );

    if (!res.ok) {
      throw new Error(`Failed to fetch repositories: ${res.status}`);
    }

    const batch = await res.json();

    if (batch.length === 0) break;

    repos.push(...batch);
    page++;
  }

  return repos.filter((repo) => !repo.fork);
}

async function getLanguagesForRepo(repoName) {
  const res = await fetch(
    `${API}/repos/${USERNAME}/${repoName}/languages`,
    { headers }
  );

  if (!res.ok) {
    console.warn(`Skipped language data for ${repoName}: ${res.status}`);
    return {};
  }

  return res.json();
}

function toPercentages(totals) {
  const totalBytes = Object.values(totals).reduce(
    (sum, bytes) => sum + bytes,
    0
  );

  if (totalBytes === 0) return [];

  const sorted = Object.entries(totals)
    .map(([lang, bytes]) => ({
      lang,
      pct: Math.round((bytes / totalBytes) * 1000) / 10,
      bytes,
    }))
    .sort((a, b) => b.bytes - a.bytes);

  const top = sorted.slice(0, MAX_LANGUAGE_ROWS).map(({ lang, pct }) => ({
    lang,
    pct,
  }));

  const otherPct =
    Math.round(
      sorted
        .slice(MAX_LANGUAGE_ROWS)
        .reduce((sum, lang) => sum + lang.pct, 0) * 10
    ) / 10;

  if (otherPct > 0) {
    top.push({ lang: "other", pct: otherPct });
  }

  return top;
}

// ---------- GraphQL: overall GitHub stats ----------

async function graphql(query) {
  const res = await fetch(GRAPHQL_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });

  const json = await res.json();

  if (!res.ok || json.errors) {
    throw new Error(
      `GitHub GraphQL error: ${JSON.stringify(json.errors || json)}`
    );
  }

  return json.data;
}

async function getGithubStats() {
  const now = new Date();
  const from = new Date(now);
  from.setFullYear(from.getFullYear() - 1);

  const query = `
    query {
      user(login: "${USERNAME}") {
        pullRequests { totalCount }
        openIssues: issues(states: OPEN) { totalCount }
        closedIssues: issues(states: CLOSED) { totalCount }
        repositoriesContributedTo(
          first: 1
          contributionTypes: [COMMIT, PULL_REQUEST, ISSUE]
        ) {
          totalCount
        }
        contributionsCollection(
          from: "${from.toISOString()}"
          to: "${now.toISOString()}"
        ) {
          totalCommitContributions
          contributionCalendar {
            weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
        }
      }
    }
  `;

  const data = await graphql(query);
  const user = data.user;

  return {
    totalCommits: user.contributionsCollection.totalCommitContributions,
    totalPRs: user.pullRequests.totalCount,
    totalIssues:
      user.openIssues.totalCount + user.closedIssues.totalCount,
    contributedTo: user.repositoriesContributedTo.totalCount,
    calendarDays:
      user.contributionsCollection.contributionCalendar.weeks.flatMap(
        (week) => week.contributionDays
      ),
  };
}

function monthlyTotalsFromCalendar(days) {
  const buckets = {};

  for (const day of days) {
    const month = day.date.slice(0, 7);
    buckets[month] = (buckets[month] || 0) + day.contributionCount;
  }

  return Object.keys(buckets)
    .sort()
    .slice(-12)
    .map((month) => ({
      month,
      count: buckets[month],
    }));
}

// ---------- Rendering ----------

function buildLanguageRowsTelemetry(languages) {
  if (languages.length === 0) return "";

  const MAX_BAR_WIDTH = 220;
  const topPct = Math.max(...languages.map((lang) => lang.pct));

  let bars = "";
  let yLabel = 108;
  let yBar = 116;
  let yPct = 123;
  const ROW_HEIGHT = 38;

  for (let i = 0; i < languages.length; i++) {
    const { lang, pct } = languages[i];
    const width = Math.max(
      4,
      Math.round((pct / topPct) * MAX_BAR_WIDTH)
    );

    const fillVar = i === 0 ? "var(--accent)" : "var(--bone)";
    const barClass = `g${i + 1}`;

    bars +=
      `    <text fill="var(--bone)" x="48" y="${yLabel}">${lang.toLowerCase()}</text>` +
      `<rect class="bar ${barClass}" x="48" y="${yBar}" width="${width}" height="6" fill="${fillVar}"/>` +
      `<text fill="var(--muted)" x="${48 + width + 10}" y="${yPct}" font-size="10">${pct}%</text>\n`;

    yLabel += ROW_HEIGHT;
    yBar += ROW_HEIGHT;
    yPct += ROW_HEIGHT;
  }

  return bars.trim();
}

function buildLanguageBarsForStatsPanel(languages) {
  if (languages.length === 0) return "";

  const MAX_BAR_WIDTH = 270;
  const topPct = Math.max(...languages.map((lang) => lang.pct));

  let rows = "";
  let y = 105;
  let yRect = 94;
  const ROW_HEIGHT = 36;

  for (let i = 0; i < languages.length; i++) {
    const { lang, pct } = languages[i];
    const width = Math.max(
      4,
      Math.round((pct / topPct) * MAX_BAR_WIDTH)
    );

    const growClass = i === 0 ? "grow" : `grow g${i + 1}`;

    rows +=
      `    <text x="548" y="${y}" font-size="10">${lang.toUpperCase()}</text>` +
      `<rect class="bar" x="660" y="${yRect}" width="${MAX_BAR_WIDTH}" height="12"/>` +
      `<rect class="fill ${growClass}" x="660" y="${yRect}" width="${width}" height="12"/>\n`;

    y += ROW_HEIGHT;
    yRect += ROW_HEIGHT;
  }

  return rows.trim();
}

function buildContributionBars(monthly) {
  if (monthly.length === 0) return "";

  const CHART_LEFT = 48;
  const CHART_RIGHT = 952;
  const CHART_TOP = 60;
  const CHART_BOTTOM = 180;
  const maxCount = Math.max(1, ...monthly.map((month) => month.count));
  const slot = (CHART_RIGHT - CHART_LEFT) / monthly.length;
  const barWidth = slot * 0.55;

  let bars = "";

  monthly.forEach((month, i) => {
    const height = Math.round(
      ((CHART_BOTTOM - CHART_TOP) * month.count) / maxCount
    );
    const x = CHART_LEFT + i * slot + (slot - barWidth) / 2;
    const y = CHART_BOTTOM - height;
    const label = month.month.slice(5, 7);

    bars +=
      `<rect class="bar" x="${x.toFixed(1)}" y="${y}" ` +
      `width="${barWidth.toFixed(1)}" height="${height}" ` +
      `fill="var(--ink)" style="transform-origin:${x.toFixed(1)}px ${CHART_BOTTOM}px"/>\n`;

    bars +=
      `<text x="${(x + barWidth / 2).toFixed(1)}" ` +
      `y="${CHART_BOTTOM + 16}" text-anchor="middle" ` +
      `fill="var(--dim)">${label}</text>\n`;
  });

  return bars.trim();
}

async function renderFromTemplate(templatePath, outputPath, replacements) {
  let svg = await fs.readFile(templatePath, "utf8");

  for (const [placeholder, value] of Object.entries(replacements)) {
    svg = svg.replaceAll(placeholder, value);
  }

  const directory =
    outputPath.split("/").slice(0, -1).join("/") || ".";

  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(outputPath, svg);
  console.log(`Wrote ${outputPath}`);
}

// ---------- Main ----------

async function main() {
  console.log(`Fetching repositories for ${USERNAME}...`);

  const repos = await getAllRepos();
  console.log(`Found ${repos.length} public, non-fork repositories.`);

  // Overall stars still count across all public, non-fork repositories.
  const totalStars = repos.reduce(
    (sum, repo) => sum + (repo.stargazers_count || 0),
    0
  );

  // Only selected repositories contribute to the language charts.
  const languageRepos = repos.filter((repo) =>
    LANGUAGE_REPOS.has(repo.name)
  );

  const foundNames = new Set(languageRepos.map((repo) => repo.name));
  const missingNames = [...LANGUAGE_REPOS].filter(
    (name) => !foundNames.has(name)
  );

  console.log(
    "Repositories used for language charts:",
    languageRepos.map((repo) => repo.name)
  );

  if (missingNames.length > 0) {
    console.warn(
      "These selected repositories were not found among public, non-fork repositories:",
      missingNames
    );
  }

  const languageTotals = {};

  for (const repo of languageRepos) {
    const langs = await getLanguagesForRepo(repo.name);

    for (const [lang, bytes] of Object.entries(langs)) {
      languageTotals[lang] = (languageTotals[lang] || 0) + bytes;
    }
  }

  const languages = toPercentages(languageTotals);

  console.log("Fetching overall GitHub stats via GraphQL...");
  const ghStats = await getGithubStats();
  const monthly = monthlyTotalsFromCalendar(ghStats.calendarDays);

  const stats = {
    generatedAt: new Date().toISOString(),
    repoCount: repos.length,
    totalStars,
    languages,
    totalCommits: ghStats.totalCommits,
    totalPRs: ghStats.totalPRs,
    totalIssues: ghStats.totalIssues,
    contributedTo: ghStats.contributedTo,
    monthlyContributions: monthly,
  };

  console.log("Computed stats:", JSON.stringify(stats, null, 2));

  await fs.mkdir("assets", { recursive: true });
  await fs.writeFile("assets/stats.json", JSON.stringify(stats, null, 2));

  // 1. Telemetry panel
  const telemetryBars = buildLanguageRowsTelemetry(languages);

  for (const target of TELEMETRY_TARGETS) {
    await renderFromTemplate(target.template, target.output, {
      "<!-- LANGUAGE_ROWS -->": telemetryBars,
      "{{REPO_COUNT}}": String(stats.repoCount),
    });
  }

  // 2. GitHub stats panel
  const statsLangBars = buildLanguageBarsForStatsPanel(languages);

  for (const target of GITHUB_STATS_TARGETS) {
    await renderFromTemplate(target.template, target.output, {
      "{{TOTAL_STARS}}": String(stats.totalStars),
      "{{TOTAL_COMMITS}}": String(stats.totalCommits),
      "{{TOTAL_PRS}}": String(stats.totalPRs),
      "{{TOTAL_ISSUES}}": String(stats.totalIssues),
      "{{CONTRIBUTED_TO}}": String(stats.contributedTo),
      "<!-- LANGUAGE_BAR_ROWS -->": statsLangBars,
    });
  }

  // 3. Contribution graph
  const contributionBars = buildContributionBars(monthly);

  for (const target of CONTRIBUTION_TARGETS) {
    await renderFromTemplate(target.template, target.output, {
      "<!-- CONTRIBUTION_BARS -->": contributionBars,
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
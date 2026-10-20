(() => {
    const terminal = document.querySelector("#terminal") || document.querySelector(".terminal");
    if (!terminal) return;

    const terminalOutput = terminal.querySelector(".terminal-output");
    const input = terminal.querySelector(".terminal-command-input");
    if (!terminalOutput || !input) return;

    const page = document.body.dataset.page;
    terminal.querySelector(".terminal-input-row .has-text-primary")?.classList.add("terminal-user");
    const githubUsername = "atharvakdotdev";
    const pageQuery = new URLSearchParams(window.location.search);
    const requestedRepositoryName = pageQuery.get("repo");
    const requestedVideoId = pageQuery.get("video");
    const requestedBlogSlug = pageQuery.get("post");
    const repositoryCacheKey = `portfolio.repos.v1.${githubUsername}`;
    const repositoryCacheDuration = 5 * 60 * 1000;
    const markdownLibraryLoads = new Map();
    const skills = [
        { name: "Software development", detail: "Building practical software and learning by shipping projects." },
        { name: "Artificial intelligence", detail: "Exploring AI tools and applications." },
        { name: "Brain-computer interfaces", detail: "Exploring BCI and EMG-based interaction." },
    ];
    const videos = [];
    let blogPosts = [];
    let repositories = [];
    let selectedRepository = null;
    let selectedVideo = null;
    let selectedBlog = null;
    let repositoryLoadError = null;
    let blogLoadError = null;
    let markdownLibrariesPromise = null;
    let fastfetchInterval = null;

    function createTextOutput(text, isSuccess) {
        const isHtmlOutput = /<\s*(div|a|strong|span)[^>]*>/i.test(text);
        const output = document.createElement(isHtmlOutput ? "div" : "p");
        output.className = `subtitle is-6 mb-3 ${isSuccess ? "has-text-success" : "has-text-danger"}`;
        output.style.margin = "0.35rem 0 0";

        const formatted = isHtmlOutput
            ? text.trim()
            : text
                .split(/\n\s*\n/)
                .map((paragraph) => paragraph.trim())
                .filter(Boolean)
                .map((paragraph) => paragraph
                    .replace(/^##\s*(.+)$/gm, '<span class="terminal-heading">$1</span>')
                    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
                    .replace(/\n/g, "<br>")
                )
                .join("<br><br>");

        output.innerHTML = formatted;
        return output;
    }

    function renderCommandResult(block, result, isSuccess) {
        if (result == null) return;

        const outputs = Array.isArray(result) ? result : [result];
        outputs.forEach((output) => {
            if (typeof output === "string") {
                block.appendChild(createTextOutput(output, isSuccess));
            } else if (output instanceof Node) {
                block.appendChild(output);
            }
        });
    }

    function createCommandBlock(command) {
        const block = document.createElement("div");
        block.className = "command-block";
        if (command.trim().toLowerCase() === "fastfetch") {
            block.classList.add("fastfetch-command");
        }
        if (["ls projects/", "projects"].includes(command.trim().toLowerCase())) {
            block.classList.add("project-list-command");
        }

        const arrow = document.createElement("span");
        arrow.className = "prompt-prefix";
        arrow.textContent = "→";

        const enteredCommand = document.createElement("span");
        enteredCommand.className = "command-name";
        enteredCommand.textContent = command;

        block.append(arrow, enteredCommand);
        terminalOutput.appendChild(block);
        return block;
    }

    function scrollToLatestOutput() {
        terminalOutput.scrollTop = terminalOutput.scrollHeight;
    }

    function focusTerminalInput() {
        if (!window.matchMedia("(max-width: 600px)").matches) {
            input.focus({ preventScroll: true });
        }
    }

    async function fetchRepositories() {
        try {
            const cached = JSON.parse(sessionStorage.getItem(repositoryCacheKey));
            if (cached && Date.now() - cached.savedAt < repositoryCacheDuration && Array.isArray(cached.repositories)) {
                return cached.repositories;
            }
        } catch {
            // Storage can be unavailable for local files or private browsing.
        }

        const repositories = [];
        for (let pageNumber = 1; ; pageNumber += 1) {
            const query = new URLSearchParams({
                q: `user:${githubUsername} topic:project`,
                sort: "updated",
                order: "desc",
                per_page: "100",
                page: String(pageNumber),
            });
            const response = await fetch(`https://api.github.com/search/repositories?${query}`, {
                headers: { Accept: "application/vnd.github+json" },
            });
            if (!response.ok) {
                let message = `GitHub returned ${response.status}`;
                try {
                    const error = await response.json();
                    if (error.message) message = error.message;
                } catch {
                    // Keep the HTTP status when GitHub does not return JSON.
                }
                if (response.headers.get("x-ratelimit-remaining") === "0") {
                    const resetAt = Number(response.headers.get("x-ratelimit-reset")) * 1000;
                    const waitMinutes = Math.max(1, Math.ceil((resetAt - Date.now()) / 60000));
                    throw new Error(`GitHub API rate limit reached. Try again in about ${waitMinutes} minutes.`);
                }
                throw new Error(message);
            }

            const result = await response.json();
            if (!Array.isArray(result.items)) {
                throw new Error("GitHub returned an unexpected repository search result");
            }
            repositories.push(...result.items.filter((repository) =>
                repository.owner?.login?.toLowerCase() === githubUsername.toLowerCase()
                && !repository.fork
                && (!Array.isArray(repository.topics)
                    || repository.topics.some((topic) => topic.toLowerCase() === "project"))
            ));
            if (result.items.length < 100 || repositories.length >= result.total_count) break;
        }

        try {
            sessionStorage.setItem(repositoryCacheKey, JSON.stringify({
                savedAt: Date.now(),
                repositories,
            }));
        } catch {
            // The live repository list remains usable without a cache.
        }
        return repositories;
    }

    async function fetchBlogPosts() {
        const blogDirectory = page === "home" ? "blogs/"
            : page === "blogs" || page === "blog" ? ""
                : "../blogs/";
        const blogAssetUrl = (filename) => new URL(`${blogDirectory}${filename}`, window.location.href);
        const response = await fetch(blogAssetUrl("posts.json"));
        if (!response.ok) {
            throw new Error(`Could not load the local blog index (server returned ${response.status})`);
        }

        const files = await response.json();
        if (!Array.isArray(files)) {
            throw new Error("The local blog index is not a valid file list");
        }

        const posts = await Promise.all(files
            .filter((filename) => typeof filename === "string" && /^[\w -]+\.md$/i.test(filename))
            .map(async (filename) => {
                const markdownResponse = await fetch(blogAssetUrl(filename));
                if (!markdownResponse.ok) {
                    throw new Error(`Could not load ${filename}: server returned ${markdownResponse.status}`);
                }

                const content = await markdownResponse.text();
                const title = content.match(/^#\s+(.+)$/m)?.[1].trim()
                    ?? filename.replace(/\.md$/i, "").replace(/[-_]+/g, " ");
                const excerpt = content
                    .replace(/^---\s*[\r\n]+[\s\S]*?[\r\n]+---\s*/, "")
                    .replace(/```[\s\S]*?```/g, " ")
                    .split(/\r?\n\s*\r?\n/)
                    .map((block) => block.trim())
                    .find((block) => block && !/^#{1,6}\s/.test(block))
                    ?.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
                    .replace(/[`*_~>#]/g, "")
                    .replace(/\s+/g, " ")
                    .trim()
                    .slice(0, 180) ?? "";

                return {
                    slug: filename.replace(/\.md$/i, ""),
                    source: filename,
                    title,
                    excerpt,
                    content,
                };
            }));

        return posts;
    }

    const blogsReady = fetchBlogPosts()
        .then((loadedPosts) => {
            blogPosts = loadedPosts;
            selectedBlog = blogPosts.find((post) =>
                post.slug.toLowerCase() === requestedBlogSlug?.toLowerCase()
            ) ?? null;
            if (selectedBlog) {
                terminal.querySelector(".window-title").textContent = `atharvak@dev: ~/blogs/${selectedBlog.slug}`;
                document.title = `Atharva | ${selectedBlog.title}`;
            }
            return blogPosts;
        })
        .catch((error) => {
            blogLoadError = error;
            return [];
        });

    const repositoriesReady = fetchRepositories()
        .then((loadedRepositories) => {
            repositories = loadedRepositories;
            selectedRepository = repositories.find((repository) =>
                repository.name.toLowerCase() === requestedRepositoryName?.toLowerCase()
            ) ?? null;
            selectedVideo = videos.find((video) =>
                video.slug.toLowerCase() === requestedVideoId?.toLowerCase()
            ) ?? null;
            if (selectedRepository) {
                terminal.querySelector(".window-title").textContent = `atharvak@dev: ~/projects/${selectedRepository.name}`;
                document.title = `Atharva | ${selectedRepository.name}`;
            }
            if (selectedVideo) {
                terminal.querySelector(".window-title").textContent = `atharvak@dev: ~/videos/${selectedVideo.slug}`;
                document.title = `Atharva | ${selectedVideo.title}`;
            }
            return repositories;
        })
        .catch((error) => {
            repositoryLoadError = error;
            return [];
        });

    function createMessage(text) {
        const message = document.createElement("p");
        message.className = "subtitle is-6";
        message.textContent = text;
        return message;
    }

    function formatUptime() {
        const now = new Date();
        let years = now.getUTCFullYear() - 2008;
        let anniversary = Date.UTC(2008 + years, 4, 12);
        if (anniversary > now.getTime()) {
            years -= 1;
            anniversary = Date.UTC(2008 + years, 4, 12);
        }

        let months = (now.getUTCFullYear() - (2008 + years)) * 12 + now.getUTCMonth() - 4;
        if (now.getUTCDate() < 12) months -= 1;
        anniversary = Date.UTC(2008 + years, 4 + months, 12);

        let remainingSeconds = Math.floor((now.getTime() - anniversary) / 1000);
        const days = Math.floor(remainingSeconds / 86400);
        remainingSeconds %= 86400;
        const hours = Math.floor(remainingSeconds / 3600);
        remainingSeconds %= 3600;
        const minutes = Math.floor(remainingSeconds / 60);
        const seconds = remainingSeconds % 60;
        return `${years} years ${months} months ${days} days ${hours} hours ${minutes} minutes ${seconds} seconds`;
    }

    async function createFastfetchOutput() {
        await repositoriesReady;
        if (fastfetchInterval) window.clearInterval(fastfetchInterval);

        const output = document.createElement("section");
        output.className = "fastfetch-output";

        const profilePicture = document.createElement("div");
        profilePicture.className = "fastfetch-picture";

        const asciiPicture = document.createElement("img");
        asciiPicture.className = "fastfetch-image fastfetch-ascii";
        asciiPicture.src = page === "home" ? "static/image.png" : "../static/image.png";
        asciiPicture.alt = "";
        const realPicture = document.createElement("img");
        realPicture.className = "fastfetch-image fastfetch-real";
        realPicture.src = page === "home" ? "static/pfp.png" : "../static/pfp.png";
        realPicture.alt = "Profile picture";
        profilePicture.append(asciiPicture, realPicture);

        const details = document.createElement("div");
        details.className = "fastfetch-details";
        const fields = [
            ["User", "Atharva Dixit"],
            ["Uptime", ""],
            ["Projects", `(${repositories.length})`],
            ["Skills", String(skills.length)],
            ["IP", "Solapur, Maharashtra"],
            ["Education", "FY BTech CSE"],
        ];
        const uptimeValue = document.createElement("span");
        uptimeValue.className = "fastfetch-value";

        fields.forEach(([label, value]) => {
            const row = document.createElement("div");
            row.className = "fastfetch-field";
            const fieldLabel = document.createElement("span");
            fieldLabel.className = "fastfetch-label";
            fieldLabel.textContent = `${label}:`;
            const fieldValue = label === "Uptime" ? uptimeValue : document.createElement("span");
            fieldValue.classList.add("fastfetch-value");
            fieldValue.textContent = label === "Uptime" ? formatUptime() : value;
            row.append(fieldLabel, fieldValue);
            details.appendChild(row);
        });

        const colorBlocks = document.createElement("div");
        colorBlocks.className = "fastfetch-color-blocks";
        colorBlocks.setAttribute("aria-hidden", "true");
        ["#20242b", "#e06c75", "#98c379", "#e5c07b", "#61afef", "#c678dd", "#56b6c2", "#d9d7ce"]
            .forEach((color) => {
                const block = document.createElement("span");
                block.style.backgroundColor = color;
                colorBlocks.appendChild(block);
            });

        const info = document.createElement("div");
        info.className = "fastfetch-info";
        info.append(details, colorBlocks);
        output.append(profilePicture, info);
        fastfetchInterval = window.setInterval(() => {
            uptimeValue.textContent = formatUptime();
        }, 1000);
        return output;
    }

    function directoryPageUrl(directory) {
        if (directory === "home/") return homePageUrl();
        if (directory === "projects/") {
            if (page === "home") return "projects/index.html";
            if (page === "projects" || page === "project") return "index.html";
            return "../projects/index.html";
        }
        if (directory === "skills/") {
            if (page === "home") return "skills/index.html";
            if (page === "skills") return "index.html";
            return "../skills/index.html";
        }
        if (directory === "videos/") {
            if (page === "home") return "videos/index.html";
            if (page === "videos" || page === "video") return "index.html";
            return "../videos/index.html";
        }
        if (directory === "blogs/") {
            if (page === "home") return "blogs/index.html";
            if (page === "blogs" || page === "blog") return "index.html";
            return "../blogs/index.html";
        }
        return "#";
    }

    function repositoryPageUrl(repository) {
        const query = `?repo=${encodeURIComponent(repository.name)}`;
        if (page === "home") return `projects/index.html${query}`;
        if (page === "projects" || page === "project") return `index.html${query}`;
        return `../projects/index.html${query}`;
    }

    function videoPageUrl(video) {
        const query = `?video=${encodeURIComponent(video.slug)}`;
        if (page === "home") return `videos/watch.html${query}`;
        if (page === "videos" || page === "video") return `watch.html${query}`;
        return `../videos/watch.html${query}`;
    }

    function blogPageUrl(post) {
        const query = `?post=${encodeURIComponent(post.slug)}`;
        if (page === "home") return `blogs/index.html${query}`;
        if (page === "blogs" || page === "blog") return `index.html${query}`;
        return `../blogs/index.html${query}`;
    }

    function homePageUrl() {
        return page === "home" ? "index.html" : "../index.html";
    }

    function currentDirectorySegments() {
        if (page === "home") return [];
        if (page === "projects") {
            return requestedRepositoryName ? ["projects", selectedRepository?.name ?? requestedRepositoryName] : ["projects"];
        }
        if (page === "project") {
            return ["projects", document.body.dataset.projectName.toLowerCase().replace(/\s+/g, "-")];
        }
        if (page === "blogs") return selectedBlog ? ["blogs", selectedBlog.slug] : ["blogs"];
        if (page === "skills") return ["skills"];
        if (page === "video") return selectedVideo ? ["videos", selectedVideo.slug] : ["videos"];
        if (page === "videos") return ["videos"];
        return [];
    }

    function normalizePath(target = "") {
        const segments = target.startsWith("/") ? [] : currentDirectorySegments();
        target.split("/").forEach((segment) => {
            if (!segment || segment === ".") return;
            if (segment === "..") {
                segments.pop();
            } else {
                segments.push(segment);
            }
        });
        return segments;
    }

    function pageUrlForPath(segments) {
        if (!segments.length || (segments.length === 1 && segments[0].toLowerCase() === "home")) {
            return homePageUrl();
        }
        if (segments.length === 1) {
            const directory = `${segments[0].toLowerCase()}/`;
            return ["projects/", "skills/", "blogs/", "videos/"].includes(directory)
                ? directoryPageUrl(directory)
                : null;
        }
        if (segments.length === 2 && segments[0].toLowerCase() === "projects") {
            const repository = repositories.find((candidate) =>
                candidate.name.toLowerCase() === segments[1].toLowerCase()
            );
            return repository ? repositoryPageUrl(repository) : null;
        }
        if (segments.length === 2 && segments[0].toLowerCase() === "blogs") {
            const post = blogPosts.find((candidate) =>
                candidate.slug.toLowerCase() === segments[1].toLowerCase()
            );
            return post ? blogPageUrl(post) : null;
        }
        if (segments.length === 2 && segments[0].toLowerCase() === "videos") {
            const video = videos.find((candidate) =>
                candidate.slug.toLowerCase() === segments[1].toLowerCase()
            );
            return video ? videoPageUrl(video) : null;
        }
        return null;
    }

    async function listDirectory(target = "") {
        const segments = normalizePath(target);
        const path = segments.map((segment) => segment.toLowerCase());
        if (!path.length || (path.length === 1 && path[0] === "home")) {
            return createDirectoryListing((directory) => executeCommand(`cd ${directory}`));
        }
        if (path.length === 1 && path[0] === "projects") {
            await repositoriesReady;
            return createRepositoryList();
        }
        if (path.length === 1 && path[0] === "blogs") {
            await blogsReady;
            return createBlogsPage();
        }
        if (path.length === 1 && path[0] === "skills") return createSkillsPage();
        if (path.length === 1 && path[0] === "videos") return createVideoGallery();
        if (path.length === 2 && path[0] === "projects") {
            const repository = repositories.find((candidate) => candidate.name.toLowerCase() === path[1]);
            return repository ? createMessage("README.md") : createMessage(`No such directory: ${segments[1]}/`);
        }
        if (path.length === 2 && path[0] === "blogs") {
            const post = blogPosts.find((candidate) => candidate.slug.toLowerCase() === path[1]);
            return post ? createMessage(post.source) : createMessage(`No such directory: ${segments[1]}/`);
        }
        return createMessage(`No such directory: ${target || "."}`);
    }

    async function navigateToPath(target) {
        const segments = normalizePath(target);
        const url = pageUrlForPath(segments);
        if (url) {
            window.location.href = url;
            return null;
        }
        return `No such directory: ${target || "."}`;
    }

    function createSkillsPage() {
        const container = document.createElement("section");
        container.className = "skills-page";
        const heading = document.createElement("strong");
        heading.textContent = "Skills & focus areas";
        container.appendChild(heading);

        const grid = document.createElement("div");
        grid.className = "skills-grid";
        skills.forEach((skill) => {
            const item = document.createElement("article");
            item.className = "skill-item";
            const title = document.createElement("h2");
            title.textContent = skill.name;
            const detail = createMessage(skill.detail);
            item.append(title, detail);
            grid.appendChild(item);
        });
        container.appendChild(grid);
        return container;
    }

    function createBlogsPage() {
        const pageContent = document.createElement("section");
        pageContent.className = "blog-index";
        const heading = document.createElement("strong");
        heading.textContent = blogLoadError ? "Blog posts" : `Blog posts (${blogPosts.length})`;
        pageContent.appendChild(heading);

        if (blogLoadError) {
            pageContent.appendChild(createMessage(`Could not load blog posts: ${blogLoadError.message}.`));
            return pageContent;
        }

        if (blogPosts.length === 0) {
            pageContent.appendChild(createMessage("No blog posts published yet."));
            return pageContent;
        }

        const list = document.createElement("div");
        list.className = "blog-list";
        blogPosts.forEach((post) => {
            const entry = document.createElement("article");
            entry.className = "blog-entry";
            const link = document.createElement("a");
            link.href = blogPageUrl(post);
            link.textContent = post.title;
            const excerpt = createMessage(post.excerpt);
            entry.append(link, excerpt);
            list.appendChild(entry);
        });
        pageContent.appendChild(list);
        return pageContent;
    }

    async function createBlogDetails() {
        if (!selectedBlog) {
            return createMessage("Blog post not found. Browse all posts with ls blogs/.");
        }

        const [markdownParser, sanitizer] = await loadMarkdownLibraries();
        const article = document.createElement("article");
        article.className = "repo-readme blog-post";
        article.innerHTML = sanitizer.sanitize(
            markdownParser.parse(selectedBlog.content, { gfm: true }),
            { USE_PROFILES: { html: true } }
        );
        return article;
    }

    function createVideoGallery() {
        const gallery = document.createElement("section");
        gallery.className = "video-gallery";
        const heading = document.createElement("strong");
        heading.textContent = `Videos (${videos.length})`;
        gallery.appendChild(heading);

        if (videos.length === 0) {
            gallery.appendChild(createMessage("No videos available yet."));
            return gallery;
        }

        const grid = document.createElement("div");
        grid.className = "video-grid";
        videos.forEach((video) => {
            const link = document.createElement("a");
            link.className = "video-card";
            link.href = videoPageUrl(video);

            const thumbnail = document.createElement("img");
            thumbnail.className = "video-thumbnail";
            thumbnail.src = video.thumbnailUrl || `https://img.youtube.com/vi/${encodeURIComponent(video.youtubeId)}/hqdefault.jpg`;
            thumbnail.alt = `${video.title} thumbnail`;
            thumbnail.loading = "lazy";

            const title = document.createElement("strong");
            title.className = "video-card-title";
            title.textContent = video.title;
            link.append(thumbnail, title);
            grid.appendChild(link);
        });
        gallery.appendChild(grid);
        return gallery;
    }

    function createVideoDetails() {
        if (!selectedVideo) {
            return createMessage("Video not found. Browse all videos with ls videos/.");
        }

        const detail = document.createElement("section");
        detail.className = "video-detail";
        const heading = document.createElement("h1");
        heading.textContent = selectedVideo.title;
        detail.appendChild(heading);
        if (selectedVideo.description) {
            detail.appendChild(createMessage(selectedVideo.description));
        }

        const player = document.createElement("div");
        player.className = "video-player";
        const frame = document.createElement("iframe");
        frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(selectedVideo.youtubeId)}`;
        frame.title = selectedVideo.title;
        frame.loading = "lazy";
        frame.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
        frame.referrerPolicy = "strict-origin-when-cross-origin";
        frame.allowFullscreen = true;
        player.appendChild(frame);
        detail.appendChild(player);
        return detail;
    }

    function createRepositoryList() {
        if (repositoryLoadError) {
            return createMessage(`Could not load GitHub repositories: ${repositoryLoadError.message}. Try again later.`);
        }

        const container = document.createElement("div");
        const heading = document.createElement("strong");
        heading.textContent = `Projects (${repositories.length}):`;
        container.appendChild(heading);

        const list = document.createElement("div");
        list.className = "project-list";
        repositories.forEach((repository) => {
            const link = document.createElement("a");
            link.href = repositoryPageUrl(repository);
            link.textContent = `${repository.name}/`;
            list.appendChild(link);
        });
        container.appendChild(list);
        return container;
    }

    function createDirectoryListing(onSelect) {
        const container = document.createElement("div");
        const heading = document.createElement("strong");
        heading.textContent = "Directories:";
        container.appendChild(heading);

        const list = document.createElement("div");
        list.className = "social-links directory-list";
        ["home/", "projects/", "skills/", "blogs/", "videos/"].forEach((directory) => {
            const link = document.createElement("a");
            link.href = directoryPageUrl(directory);
            link.textContent = directory;
            link.addEventListener("click", (event) => {
                event.preventDefault();
                onSelect(directory);
            });
            list.appendChild(link);
        });
        container.appendChild(list);
        return container;
    }

    function createRepositoryDetails(repository) {
        const details = document.createElement("div");
        const heading = document.createElement("strong");
        heading.textContent = repository.name;
        details.appendChild(heading);

        const summary = createMessage(repository.description || "No description provided.");
        details.appendChild(summary);
        if (repository.language) {
            details.appendChild(createMessage(`Primary language: ${repository.language}`));
        }

        const repositoryLink = document.createElement("a");
        repositoryLink.href = repository.html_url;
        repositoryLink.target = "_blank";
        repositoryLink.rel = "noreferrer";
        repositoryLink.textContent = "Open repository on GitHub";
        details.appendChild(repositoryLink);
        return details;
    }

    async function showRepositoryReadme() {
        let markdown = "";
        for (const filename of ["README.md", "README.MD", "readme.md", "Readme.md"]) {
            const url = `https://raw.githubusercontent.com/${selectedRepository.full_name}/${encodeURIComponent(selectedRepository.default_branch)}/${filename}`;
            const response = await fetch(url);
            if (response.ok) {
                markdown = await response.text();
                break;
            }
            if (response.status !== 404) {
                throw new Error(`Could not load README.md: server returned ${response.status}`);
            }
        }
        if (!markdown) {
            return createMessage(`No README.md found in ${selectedRepository.name}.`);
        }
        const [markdownParser, sanitizer] = await loadMarkdownLibraries();
        const readmeContent = document.createElement("div");
        readmeContent.className = "repo-readme";
        const renderedMarkdown = markdownParser.parse(markdown, { gfm: true });
        readmeContent.innerHTML = sanitizer.sanitize(renderedMarkdown, { USE_PROFILES: { html: true } });

        const content = createRepositoryDetails(selectedRepository);
        content.appendChild(readmeContent);
        return content;
    }

    function loadMarkdownLibrary(url, globalName) {
        if (window[globalName]) return Promise.resolve(window[globalName]);
        if (markdownLibraryLoads.has(globalName)) return markdownLibraryLoads.get(globalName);

        const libraryPromise = new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = url;
            script.async = true;
            script.onload = () => {
                if (window[globalName]) {
                    resolve(window[globalName]);
                } else {
                    reject(new Error(`Could not initialize ${globalName}`));
                }
            };
            script.onerror = () => reject(new Error(`Could not load ${globalName}`));
            document.head.appendChild(script);
        }).catch((error) => {
            markdownLibraryLoads.delete(globalName);
            throw error;
        });

        markdownLibraryLoads.set(globalName, libraryPromise);
        return libraryPromise;
    }

    function loadMarkdownLibraries() {
        if (!markdownLibrariesPromise) {
            markdownLibrariesPromise = Promise.all([
                loadMarkdownLibrary("https://cdn.jsdelivr.net/npm/marked@15.0.12/marked.min.js", "marked"),
                loadMarkdownLibrary("https://cdn.jsdelivr.net/npm/dompurify@3.3.1/dist/purify.min.js", "DOMPurify"),
            ]);
        }
        return markdownLibrariesPromise;
    }

    const homeCommands = {
        "fastfetch": () => createFastfetchOutput(),
        "whoami": () => `<div class="intro-text">
            <h1 class="intro-name">Atharva</h1>
            <p>18, he/him. I like turning ideas into working software and exploring what technology can do. I’m interested in <strong>software development</strong>, <strong>AI</strong>, and <strong>Brain-Computer Interfaces</strong> (BCIs).</p>
            <p>Currently building projects, experimenting with new ideas, and learning by shipping things that solve real problems.</p>
            <p>Always curious about what I can build next.</p>
        </div>`,
        "hostname -i": () => "Solapur, Maharashtra, India",
        "curl atharvak.dev": () => `
            <div>
                <strong>Links:</strong>
                <div class="social-links">
                    <a href="https://github.com/atharvakdotdev" target="_blank" rel="noreferrer">/GitHub</a>
                    <a href="https://www.linkedin.com/in/atharva-dixit-28a5ab320/" target="_blank" rel="noreferrer">/LinkedIn</a>
                    <a href="https://www.instagram.com/atharvak.dev/" target="_blank" rel="noreferrer">/Instagram</a>
                    <a href="mailto:atharvak.dixit@gmail.com">/Email</a>
                </div>
            </div>
        `,
        "git pull": () => `<div class="github-graph">
            <div class="github-graph-label">Contributions in the last year</div>
            <img src="https://ghchart.rshah.org/0495b6/atharvakdotdev" alt="GitHub contribution activity over the last year" />
            <div class="github-legend" aria-label="Contribution activity: less to more">
                <span>Less</span>
                <div class="github-legend-swatches" aria-hidden="true">
                    <span></span><span></span><span></span><span></span><span></span>
                </div>
                <span>→ More</span>
            </div>
        </div>`,
    };

    function showProjectDetails() {
        return `<div>
            <strong>${document.body.dataset.projectName}</strong>
            <p>Project details will be added here.</p>
            <a href="index.html">← Back to projects</a>
        </div>`;
    }

    const sharedCommands = {
        "clear": () => {
            terminalOutput.replaceChildren();
            if (fastfetchInterval) window.clearInterval(fastfetchInterval);
            fastfetchInterval = null;
            return null;
        },
        "home": () => {
            window.location.href = homePageUrl();
            return null;
        },
        "help": () => "Commands: fastfetch, whoami, hostname -i, curl atharvak.dev, ls, cd <directory>/, cd .., cd home/, cat README.md, play, git pull, clear, help.",
    };

    const projectCommands = {
        "projects": async () => {
            await repositoriesReady;
            return createRepositoryList();
        },
        "cat readme.md": async () => {
            await repositoriesReady;
            if (selectedRepository) {
                try {
                    return await showRepositoryReadme();
                } catch (error) {
                    return createMessage(`Could not load README.md: ${error.message}`);
                }
            }
            return page === "project"
                ? showProjectDetails()
                : createMessage("Choose a repository with ls projects/.");
        },
    };

    const skillsCommands = {
        ...projectCommands,
        "skills": () => createSkillsPage(),
    };

    const videosCommands = {
        ...projectCommands,
        "videos": () => createVideoGallery(),
    };

    const blogsCommands = {
        ...projectCommands,
        "blogs": () => createBlogsPage(),
    };

    const videoCommands = {
        ...projectCommands,
        "play": () => createVideoDetails(),
    };

    const commandHandlers = {
        ...sharedCommands,
        ...(page === "home" ? homeCommands
            : page === "skills" ? skillsCommands
                : page === "videos" ? videosCommands
                    : page === "video" ? videoCommands
                        : page === "blogs" ? blogsCommands
                            : projectCommands),
    };

    async function executeCommand(rawCommand, { instant = false } = {}) {
        const command = rawCommand.trim().toLowerCase();
        if (!command) return;

        const block = createCommandBlock(rawCommand);
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (!instant) {
            await new Promise((resolve) => setTimeout(resolve, reducedMotion ? 0 : 300));
        }

        let isRegistered = Object.hasOwn(commandHandlers, command);
        let result;
        if (command === "ls" || command.startsWith("ls ")) {
            result = await listDirectory(rawCommand.trim().slice(2).trim());
            isRegistered = true;
        } else if (/^cd(?:\s|$)/.test(command)) {
            await Promise.all([repositoriesReady, blogsReady]);
            result = await navigateToPath(rawCommand.trim().slice(2).trim());
            isRegistered = result == null;
        } else if (isRegistered) {
            result = await commandHandlers[command](rawCommand);
        } else if (page === "blogs" && /^cat\s+[^/\\]+\.md$/.test(command)) {
            selectedBlog = blogPosts.find((post) => post.source.toLowerCase() === command.slice(4).toLowerCase()) ?? null;
            isRegistered = Boolean(selectedBlog);
            result = selectedBlog
                ? await createBlogDetails()
                : `Blog post not found: ${command.slice(4)} Browse available posts with ls blogs/.`;
        } else {
            isRegistered = false;
            result = `Command not found: ${rawCommand}`;
        }
        renderCommandResult(block, result, isRegistered);
        scrollToLatestOutput();
        focusTerminalInput();
    }

    input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        const command = input.value;
        if (!command.trim()) return;
        input.value = "";
        executeCommand(command);
    });

    function initializeSidebarTerminal(sidebar) {
        const sidebarOutput = sidebar.querySelector(".terminal-output");
        const sidebarInput = sidebar.querySelector(".terminal-command-input");
        const sidebarToggle = terminal.querySelector(".sidebar-toggle");
        const sidebarClose = sidebar.querySelector(".sidebar-close");
        const sidebarBackdrop = document.querySelector("#sidebar-backdrop");
        const workspace = sidebar.closest(".home-workspace");
        const mobileLayout = window.matchMedia("(max-width: 600px)");

        function setSidebarState(isOpen, returnFocus = false) {
            if (mobileLayout.matches) {
                sidebar.hidden = false;
                sidebar.classList.toggle("is-open", isOpen);
                sidebarBackdrop.hidden = !isOpen;
            } else {
                sidebar.classList.remove("is-open");
                sidebar.hidden = !isOpen;
                workspace.classList.toggle("sidebar-collapsed", !isOpen);
                sidebarBackdrop.hidden = true;
            }
            sidebarToggle.setAttribute("aria-expanded", String(isOpen));
            if (isOpen && mobileLayout.matches) {
                sidebarInput.focus();
            } else if (returnFocus) {
                sidebarToggle.focus();
            }
        }

        setSidebarState(!mobileLayout.matches);
        mobileLayout.addEventListener("change", () => setSidebarState(!mobileLayout.matches));

        function closeSidebar(returnFocus = true) {
            setSidebarState(false, returnFocus);
        }

        function openSidebar() {
            setSidebarState(true);
        }

        sidebarToggle.addEventListener("click", () => {
            const isOpen = sidebarToggle.getAttribute("aria-expanded") === "true";
            setSidebarState(!isOpen);
        });
        sidebarClose.addEventListener("click", () => closeSidebar());
        sidebarBackdrop.addEventListener("click", () => closeSidebar());
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && !sidebar.hidden) closeSidebar();
        });

        function appendSidebarCommand(command, result) {
            const block = document.createElement("div");
            block.className = "command-block";

            const prompt = document.createElement("span");
            prompt.className = "prompt-prefix";
            prompt.textContent = "→";

            const commandName = document.createElement("span");
            commandName.className = "command-name";
            commandName.textContent = command;
            block.append(prompt, commandName);

            if (result instanceof Node) {
                block.appendChild(result);
            } else if (typeof result === "string") {
                block.appendChild(createTextOutput(result, true));
            }

            sidebarOutput.appendChild(block);
            if (userHasInteracted) {
                sidebarOutput.scrollTop = sidebarOutput.scrollHeight;
            }
        }

        async function runSidebarCommand(rawCommand) {
            const command = rawCommand.trim().toLowerCase();
            if (!command) return;

            if (command === "clear") {
                sidebarOutput.replaceChildren();
                return;
            }
            if (command === "cd projects/") {
                window.location.href = directoryPageUrl("projects/");
                return;
            }
            if (command === "cd home/") {
                window.location.href = homePageUrl();
                return;
            }
            if (command === "cd skills/") {
                window.location.href = directoryPageUrl("skills/");
                return;
            }
            if (command === "cd videos/") {
                window.location.href = directoryPageUrl("videos/");
                return;
            }
            if (command === "cd blogs/") {
                window.location.href = directoryPageUrl("blogs/");
                return;
            }
            if (command === "cd .." || command === "home") {
                appendSidebarCommand(rawCommand, "Already at the home directory.");
                return;
            }

            let result;
            if (command === "whoami") {
                result = `<div class="intro-text"><h2 class="intro-name">Atharva</h2><p>Software development · AI · Brain-Computer Interfaces</p></div>`;
            } else if (command === "hostname -i") {
                result = "Solapur, Maharashtra, India";
            } else if (command === "ls") {
                result = createDirectoryListing((directory) => runSidebarCommand(`cd ${directory}`));
            } else if (command === "ls skills/") {
                result = createSkillsPage();
            } else if (command === "ls videos/") {
                result = createVideoGallery();
            } else if (command === "play") {
                result = createVideoDetails();
            } else if (command === "ls projects/" || command === "projects") {
                await repositoriesReady;
                result = createRepositoryList();
            } else if (command === "cd blogs/") {
                result = "blogs/ is empty for now.";
            } else if (command === "help") {
                result = "Commands: whoami, hostname -i, ls, ls projects/, cd skills/, cd projects/, cd blogs/, cd videos/, cd repository-name/, clear";
            } else if (/^cd\s+.+\/$/.test(command)) {
                await repositoriesReady;
                const repositoryName = command.slice(3, -1).trim();
                const repository = repositories.find((candidate) =>
                    candidate.name.toLowerCase() === repositoryName.toLowerCase()
                );
                if (repository) {
                    window.location.href = repositoryPageUrl(repository);
                    return;
                }
                result = `Project not found: ${repositoryName}/. Use ls projects/ to see featured projects.`;
            } else {
                result = `Command not found: ${rawCommand}`;
            }

            appendSidebarCommand(rawCommand, result);
        }

        sidebarInput.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            const command = sidebarInput.value;
            if (!command.trim()) return;
            sidebarInput.value = "";
            runSidebarCommand(command);
        });

        runSidebarCommand("ls");
        runSidebarCommand("help");

    }

    const sidebar = document.querySelector("#terminal-sidebar");
    if (sidebar) {
        initializeSidebarTerminal(sidebar);
    }
    focusTerminalInput();

    if (page === "home") {
        const commands = ["fastfetch", "whoami", "hostname -i", "curl atharvak.dev", "ls projects/", "git pull"];
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const typingAudio = new Audio("static/virtualzero-keyboard-typing-fast-371229.mp3");
        typingAudio.preload = "auto";
        typingAudio.volume = 0.35;
        let typingAudioUnlocked = false;
        let typingAudioUnlockPending = false;

        function unlockTypingAudio() {
            if (typingAudioUnlocked || typingAudioUnlockPending) return;

            typingAudioUnlockPending = true;
            typingAudio.muted = true;
            const playback = typingAudio.play();
            playback?.then(() => {
                typingAudio.pause();
                typingAudio.currentTime = 0;
                typingAudio.muted = false;
                typingAudioUnlocked = true;
            }).catch(() => {
                typingAudio.muted = false;
            }).finally(() => {
                typingAudioUnlockPending = false;
            });
        }

        document.addEventListener("pointerdown", unlockTypingAudio, { capture: true });
        document.addEventListener("touchstart", unlockTypingAudio, { passive: true, capture: true });
        document.addEventListener("keydown", unlockTypingAudio, { capture: true });

        const homeSequenceKey = "portfolio.homeSequenceVisited";
        const navigationType = performance.getEntriesByType("navigation")[0]?.type;
        let hasVisitedHome = false;
        try {
            hasVisitedHome = sessionStorage.getItem(homeSequenceKey) === "true";
        } catch {
            // The sequence can still run when session storage is unavailable.
        }
        const shouldAnimate = !hasVisitedHome || navigationType === "reload";

        window.addEventListener("pagehide", () => {
            try {
                sessionStorage.setItem(homeSequenceKey, "true");
            } catch {
                // Returning visits fall back to the standard animation.
            }
        });

        let cancelled = false;
        let isTyping = false;
        let typedCommand = "";

        const cancelSequence = () => {
            if (cancelled) return;
            cancelled = true;
            isTyping = false;
            typingAudio.pause();
        };

        input.addEventListener("input", cancelSequence);
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") cancelSequence();
        }, true);

        if (!shouldAnimate) {
            (async () => {
                for (const command of commands) {
                    await executeCommand(command, { instant: true });
                }
                input.value = "";
            })();
        } else {
            const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration));
            (async () => {
                await wait(reducedMotion ? 0 : 1500);
                for (const command of commands) {
                    if (cancelled) return;
                    isTyping = true;
                    typedCommand = "";
                    if (!reducedMotion && typingAudioUnlocked && Number.isFinite(typingAudio.duration)) {
                        const typingDuration = command.length * 0.085;
                        const latestStart = Math.max(0, typingAudio.duration - typingDuration);
                        typingAudio.currentTime = Math.random() * latestStart;
                        const playback = typingAudio.play();
                        playback?.catch(() => {});
                    }
                    for (const character of command) {
                        if (cancelled) return;
                        typedCommand += character;
                        input.value = typedCommand;
                        await wait(reducedMotion ? 0 : 85);
                    }
                    isTyping = false;
                    typingAudio.pause();
                    await wait(reducedMotion ? 0 : 250);
                    if (cancelled) return;
                    await executeCommand(command);
                    input.value = "";
                    await wait(reducedMotion ? 0 : 650);
                }
            })();
        }
    } else {
        repositoriesReady.then(async () => {
            if (page === "projects" && requestedRepositoryName) {
                if (selectedRepository) {
                    executeCommand("cat README.md");
                } else {
                    executeCommand(`cd ${requestedRepositoryName}/`);
                }
            } else if (page === "skills") {
                executeCommand("ls");
            } else if (page === "videos") {
                executeCommand("ls");
            } else if (page === "video") {
                executeCommand("play");
            } else if (page === "blogs") {
                await blogsReady;
                executeCommand(selectedBlog
                    ? `cat ${selectedBlog.source}`
                    : requestedBlogSlug ? `cat ${requestedBlogSlug}.md` : "ls");
            } else {
                executeCommand(page === "project" ? "cat README.md" : "ls");
            }
        });
    }
})();

(() => {
    const terminal = document.querySelector("#terminal") || document.querySelector(".terminal");
    if (!terminal) return;

    const terminalOutput = terminal.querySelector(".terminal-output");
    const input = terminal.querySelector(".terminal-command-input");
    if (!terminalOutput || !input) return;

    const page = document.body.dataset.page;
    let userHasInteracted = false;
    const githubUsername = "atharvakdotdev";
    const pageQuery = new URLSearchParams(window.location.search);
    const requestedRepositoryName = pageQuery.get("repo");
    const requestedVideoId = pageQuery.get("video");
    const requestedBlogSlug = pageQuery.get("post");
    const repositoryCacheKey = `portfolio.repos.v3.${githubUsername}`;
    const repositoryCacheDuration = 60 * 1000;
    const blogCacheKey = `portfolio.blogs.v2.${githubUsername}`;
    const blogCacheDuration = 60 * 1000;
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
        if (!userHasInteracted) return;
        terminalOutput.scrollTop = terminalOutput.scrollHeight;
    }

    const allowOutputAutoscroll = () => {
        userHasInteracted = true;
    };
    document.addEventListener("pointerdown", allowOutputAutoscroll, { once: true });
    document.addEventListener("touchstart", allowOutputAutoscroll, { once: true, passive: true });
    document.addEventListener("wheel", allowOutputAutoscroll, { once: true, passive: true });
    document.addEventListener("keydown", allowOutputAutoscroll, { once: true });
    document.addEventListener("input", allowOutputAutoscroll, { once: true });

    function hasProjectTopic(repository) {
        return repository.topics?.some((topic) =>
            typeof topic === "string" && topic.toLowerCase().includes("project")
        ) ?? false;
    }

    async function fetchRepositories() {
        try {
            const cached = JSON.parse(sessionStorage.getItem(repositoryCacheKey));
            if (cached && Date.now() - cached.savedAt < repositoryCacheDuration && Array.isArray(cached.repositories)) {
                return cached.repositories.filter(hasProjectTopic);
            }
        } catch {
            // Storage can be unavailable for local files or private browsing.
        }

        const allRepositories = [];
        for (let pageNumber = 1; ; pageNumber += 1) {
            const url = new URL(`https://api.github.com/users/${githubUsername}/repos`);
            url.search = new URLSearchParams({
                type: "owner",
                sort: "updated",
                per_page: "100",
                page: String(pageNumber),
            });
            const response = await fetch(url, {
                headers: { Accept: "application/vnd.github+json" },
            });
            if (!response.ok) {
                throw new Error(`GitHub returned ${response.status}`);
            }

            const batch = await response.json();
            if (!Array.isArray(batch)) {
                throw new Error("GitHub returned an unexpected repository list");
            }
            allRepositories.push(...batch);
            if (batch.length < 100) break;
        }

        const ownedRepositories = allRepositories.filter((repository) =>
            !repository.fork && repository.owner?.login?.toLowerCase() === githubUsername.toLowerCase()
        );
        try {
            sessionStorage.setItem(repositoryCacheKey, JSON.stringify({
                savedAt: Date.now(),
                repositories: ownedRepositories,
            }));
        } catch {
            // The live repository list remains usable without a cache.
        }
        return ownedRepositories.filter(hasProjectTopic);
    }

    async function fetchBlogPosts() {
        try {
            const cached = JSON.parse(sessionStorage.getItem(blogCacheKey));
            if (cached && Date.now() - cached.savedAt < blogCacheDuration && Array.isArray(cached.posts)) {
                return cached.posts;
            }
        } catch {
            // Storage can be unavailable for local files or private browsing.
        }

        const response = await fetch(`https://api.github.com/repos/${githubUsername}/${githubUsername}.github.io/contents/blogs`, {
            headers: { Accept: "application/vnd.github+json" },
        });
        if (response.status === 404) {
            throw new Error("GitHub has no published blogs/ directory yet. Push a .md file in blogs/ to publish it");
        }
        if (!response.ok) {
            throw new Error(`GitHub returned ${response.status}`);
        }

        const files = await response.json();
        if (!Array.isArray(files)) {
            throw new Error("GitHub returned an unexpected blog file list");
        }

        const posts = await Promise.all(files
            .filter((file) => file.type === "file" && /\.md$/i.test(file.name) && file.download_url)
            .map(async (file) => {
                const markdownResponse = await fetch(file.download_url);
                if (!markdownResponse.ok) {
                    throw new Error(`Could not load ${file.name}: server returned ${markdownResponse.status}`);
                }

                const content = await markdownResponse.text();
                const title = content.match(/^#\s+(.+)$/m)?.[1].trim()
                    ?? file.name.replace(/\.md$/i, "").replace(/[-_]+/g, " ");
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
                    slug: file.name.replace(/\.md$/i, ""),
                    source: file.name,
                    title,
                    excerpt,
                    content,
                };
            }));

        try {
            sessionStorage.setItem(blogCacheKey, JSON.stringify({ savedAt: Date.now(), posts }));
        } catch {
            // The live post list remains usable without a cache.
        }
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

    function directoryPageUrl(directory) {
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
        ["skills/", "projects/", "blogs/", "videos/"].forEach((directory) => {
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
        const response = await fetch(`https://api.github.com/repos/${selectedRepository.full_name}/readme`, {
            headers: { Accept: "application/vnd.github+json" },
        });
        if (response.status === 404) {
            return createMessage(`No README.md found in ${selectedRepository.name}.`);
        }
        if (!response.ok) {
            throw new Error(`GitHub returned ${response.status} while loading the README`);
        }

        const readme = await response.json();
        const binary = atob(readme.content.replace(/\s/g, ""));
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        const markdown = new TextDecoder().decode(bytes);
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
        "ls": () => createDirectoryListing((directory) => executeCommand(`cd ${directory}`)),
        "ls skills/": () => createSkillsPage(),
        "ls videos/": () => createVideoGallery(),
        "ls projects/": async () => {
            await repositoriesReady;
            return createRepositoryList();
        },
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
            return null;
        },
        "home": () => {
            window.location.href = page === "home" ? "index.html" : "../index.html";
            return null;
        },
        "cd ..": () => {
            if (page === "video" || (page === "projects" && requestedRepositoryName)) {
                window.location.href = "index.html";
            } else if (page === "project") {
                window.location.href = "index.html";
            } else if (["projects", "skills", "videos", "blogs"].includes(page)) {
                window.location.href = "../index.html";
            }
            return null;
        },
        "cd projects/": () => {
            window.location.href = directoryPageUrl("projects/");
            return null;
        },
        "cd skills/": () => {
            window.location.href = directoryPageUrl("skills/");
            return null;
        },
        "cd blogs/": () => {
            window.location.href = directoryPageUrl("blogs/");
            return null;
        },
        "cd videos/": () => {
            window.location.href = directoryPageUrl("videos/");
            return null;
        },
        "help": () => "Commands: whoami, hostname -i, curl atharvak.dev, ls, ls projects/, git pull, cat README.md, cd skills/, cd projects/, cd blogs/, cd videos/, cd repository-name/, cd .., home, clear, help. Projects must have a GitHub topic containing 'project'.",
    };

    const projectCommands = {
        "ls": () => createDirectoryListing((directory) => executeCommand(`cd ${directory}`)),
        "projects": async () => {
            await repositoriesReady;
            return createRepositoryList();
        },
        "ls projects/": async () => {
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
        "ls skills/": () => createSkillsPage(),
    };

    const videosCommands = {
        ...projectCommands,
        "videos": () => createVideoGallery(),
        "ls videos/": () => createVideoGallery(),
    };

    const blogsCommands = {
        ...projectCommands,
        "blogs": () => createBlogsPage(),
        "ls blogs/": () => createBlogsPage(),
    };

    const videoCommands = {
        ...projectCommands,
        "play": () => createVideoDetails(),
        "ls videos/": () => createVideoGallery(),
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
        if (isRegistered) {
            result = await commandHandlers[command](rawCommand);
        } else if (page === "blogs" && /^cat\s+[\w-]+\.md$/.test(command)) {
            selectedBlog = blogPosts.find((post) => post.source.toLowerCase() === command.slice(4).toLowerCase()) ?? null;
            isRegistered = Boolean(selectedBlog);
            result = selectedBlog
                ? await createBlogDetails()
                : `Blog post not found: ${command.slice(4)} Browse available posts with ls blogs/.`;
        } else if (/^cd\s+.+\/$/.test(command)) {
            await repositoriesReady;
            const repositoryName = command.slice(3, -1).trim();
            const repository = repositories.find((candidate) =>
                candidate.name.toLowerCase() === repositoryName.toLowerCase()
            );
            if (repository) {
                window.location.href = repositoryPageUrl(repository);
            } else {
                isRegistered = false;
                result = `Repository not found: ${repositoryName}/. Use ls projects/ to see available repositories.`;
            }
        } else {
            isRegistered = false;
            result = `Command not found: ${rawCommand}`;
        }
        renderCommandResult(block, result, isRegistered);
        scrollToLatestOutput();
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
    }

    const sidebar = document.querySelector("#terminal-sidebar");
    if (sidebar) {
        initializeSidebarTerminal(sidebar);
    }

    if (page === "home") {
        const commands = ["whoami", "hostname -i", "curl atharvak.dev", "ls projects/", "git pull"];
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
                executeCommand("ls skills/");
            } else if (page === "videos") {
                executeCommand("ls videos/");
            } else if (page === "video") {
                executeCommand("play");
            } else if (page === "blogs") {
                await blogsReady;
                executeCommand(selectedBlog
                    ? `cat ${selectedBlog.source}`
                    : requestedBlogSlug ? `cat ${requestedBlogSlug}.md` : "ls blogs/");
            } else {
                executeCommand(page === "project" ? "cat README.md" : "ls projects/");
            }
        });
    }
})();

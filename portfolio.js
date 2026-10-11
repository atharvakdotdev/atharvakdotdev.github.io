(() => {
    const terminal = document.querySelector(".terminal");
    if (!terminal) return;

    const terminalOutput = terminal.querySelector(".terminal-output");
    const input = terminal.querySelector(".terminal-command-input");
    if (!terminalOutput || !input) return;

    const page = document.body.dataset.page;
    let userHasInteracted = false;
    const githubUsername = "atharvakdotdev";
    const requestedRepositoryName = new URLSearchParams(window.location.search).get("repo");
    const repositoryCacheKey = `portfolio.repos.v3.${githubUsername}`;
    const repositoryCacheDuration = 60 * 1000;
    const markdownLibraryLoads = new Map();
    let repositories = [];
    let selectedRepository = null;
    let repositoryLoadError = null;
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

    const repositoriesReady = fetchRepositories()
        .then((loadedRepositories) => {
            repositories = loadedRepositories;
            selectedRepository = repositories.find((repository) =>
                repository.name.toLowerCase() === requestedRepositoryName?.toLowerCase()
            ) ?? null;
            if (selectedRepository) {
                terminal.querySelector(".window-title").textContent = `atharvak@dev: ~/projects/${selectedRepository.name}`;
                document.title = `Atharva | ${selectedRepository.name}`;
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

    function repositoryPageUrl(repository) {
        const query = `?repo=${encodeURIComponent(repository.name)}`;
        if (page === "home") return `projects/index.html${query}`;
        if (page === "project") return `index.html${query}`;
        return `index.html${query}`;
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
                    <a href="mailto:hello@atharvak.dev">/Email</a>
                </div>
            </div>
        `,
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
            if (page === "projects" && requestedRepositoryName) {
                window.location.href = "index.html";
            } else if (page === "project") {
                window.location.href = "index.html";
            } else if (page === "projects") {
                window.location.href = "../index.html";
            }
            return null;
        },
        "cd projects/": () => {
            if (page === "home") {
                window.location.href = "projects/index.html";
            } else if (page === "project" || requestedRepositoryName) {
                window.location.href = "index.html";
            }
            return null;
        },
        "help": () => "Commands: whoami, hostname -i, curl atharvak.dev, ls projects/, git pull, cat README.md, cd projects/, cd <repository-name>/, cd .., home, clear, help. Projects must have a GitHub topic containing 'project'.",
    };

    const projectCommands = {
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

    const commandHandlers = {
        ...sharedCommands,
        ...(page === "home" ? homeCommands : projectCommands),
    };

    async function executeCommand(rawCommand) {
        const command = rawCommand.trim().toLowerCase();
        if (!command) return;

        const block = createCommandBlock(rawCommand);
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        await new Promise((resolve) => setTimeout(resolve, reducedMotion ? 0 : 300));

        let isRegistered = Object.hasOwn(commandHandlers, command);
        let result;
        if (isRegistered) {
            result = await commandHandlers[command](rawCommand);
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

    if (page === "home") {
        const commands = ["whoami", "hostname -i", "curl atharvak.dev", "ls projects/", "git pull"];
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        let cancelled = false;
        let isTyping = false;
        let typedCommand = "";

        const cancelSequence = () => {
            if (cancelled) return;
            cancelled = true;
            isTyping = false;
        };

        input.addEventListener("input", cancelSequence);
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") cancelSequence();
        }, true);

        const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration));
        (async () => {
            await wait(reducedMotion ? 0 : 1500);
            for (const command of commands) {
                if (cancelled) return;
                isTyping = true;
                typedCommand = "";
                for (const character of command) {
                    if (cancelled) return;
                    typedCommand += character;
                    input.value = typedCommand;
                    await wait(reducedMotion ? 0 : 85);
                }
                isTyping = false;
                await wait(reducedMotion ? 0 : 250);
                if (cancelled) return;
                await executeCommand(command);
                input.value = "";
                await wait(reducedMotion ? 0 : 650);
            }
        })();
    } else {
        repositoriesReady.then(() => {
            if (page === "projects" && requestedRepositoryName) {
                if (selectedRepository) {
                    executeCommand("cat README.md");
                } else {
                    executeCommand(`cd ${requestedRepositoryName}/`);
                }
            } else {
                executeCommand(page === "project" ? "cat README.md" : "ls projects/");
            }
        });
    }
})();

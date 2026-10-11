(() => {
    const terminal = document.querySelector(".terminal");
    if (!terminal) return;

    const terminalOutput = terminal.querySelector(".terminal-output");
    const input = terminal.querySelector(".terminal-command-input");
    if (!terminalOutput || !input) return;

    const page = document.body.dataset.page;
    const projects = [
        { slug: "project-one", name: "Project 1" },
        { slug: "project-two", name: "Project 2" },
        { slug: "project-three", name: "Project 3" },
    ];

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
        "ls projects/": () => `
            <div>
                <strong>Projects:</strong>
                <div class="social-links">
                    ${projects.map((project) => `<a href="projects/${project.slug}.html">/${project.name.replaceAll(" ", "")}</a>`).join("")}
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

    function showProjects() {
        const projectPath = page === "home" ? "projects/" : "";
        return `<div>
            <strong>Projects:</strong>
            <div class="social-links">
                ${projects.map((project) => `<a href="${projectPath}${project.slug}.html">/${project.name.replaceAll(" ", "")}</a>`).join("")}
            </div>
        </div>`;
    }

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
            if (page === "project") {
                window.location.href = "index.html";
            } else if (page === "projects") {
                window.location.href = "../index.html";
            }
            return null;
        },
        "cd projects/": () => {
            if (page === "home") {
                window.location.href = "projects/index.html";
            } else if (page === "project") {
                window.location.href = "index.html";
            }
            return null;
        },
        "help": () => "Commands: whoami, hostname -i, curl atharvak.dev, ls projects/, git pull, cat README.md, cd projects/, cd .., home, clear, help",
    };

    const projectCommands = {
        "projects": showProjects,
        "ls projects/": showProjects,
        "cat readme.md": () => page === "project"
            ? showProjectDetails()
            : "Choose a project with ls projects/.",
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

        const isRegistered = Object.hasOwn(commandHandlers, command);
        const result = isRegistered
            ? commandHandlers[command](rawCommand)
            : `Command not found: ${rawCommand}`;
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
        executeCommand(page === "project" ? "cat README.md" : "ls projects/");
    }
})();

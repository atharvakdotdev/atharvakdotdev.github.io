const projects = [
    { slug: "project-one", name: "Project 1" },
    { slug: "project-two", name: "Project 2" },
    { slug: "project-three", name: "Project 3" },
];

const terminalOutput = document.querySelector(".terminal-output");
const commandInput = document.querySelector(".terminal-command-input");
const isProjectPage = document.body.dataset.projectPage === "true";

function addCommand(command, renderResult) {
    const block = document.createElement("div");
    block.className = "command-block";

    const prompt = document.createElement("span");
    prompt.className = "prompt-prefix";
    prompt.textContent = "→";

    const enteredCommand = document.createElement("span");
    enteredCommand.className = "command-name";
    enteredCommand.textContent = command;

    block.append(prompt, enteredCommand);
    renderResult(block);
    terminalOutput.appendChild(block);
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

function addMessage(block, text) {
    const message = document.createElement("p");
    message.className = "subtitle is-6";
    message.textContent = text;
    block.appendChild(message);
}

function showProjects(block) {
    const heading = document.createElement("p");
    heading.className = "subtitle is-6";
    const label = document.createElement("strong");
    label.textContent = "Projects:";
    heading.appendChild(label);
    block.appendChild(heading);

    const list = document.createElement("div");
    list.className = "project-list";
    projects.forEach((project) => {
        const link = document.createElement("a");
        link.href = `${project.slug}.html`;
        link.textContent = `/${project.name.replaceAll(" ", "")}`;
        const detail = document.createElement("small");
        detail.textContent = "Details coming soon";
        link.appendChild(detail);
        list.appendChild(link);
    });
    block.appendChild(list);
}

function showProjectDetails(block) {
    const projectName = document.body.dataset.projectName;
    const heading = document.createElement("p");
    heading.className = "subtitle is-6";
    const title = document.createElement("strong");
    title.textContent = projectName;
    heading.appendChild(title);
    block.appendChild(heading);
    addMessage(block, "Project details will be added here.");

    const backLink = document.createElement("a");
    backLink.href = "index.html";
    backLink.textContent = "← Back to projects";
    block.appendChild(backLink);
}

function runCommand(rawCommand) {
    const command = rawCommand.trim().toLowerCase();
    if (!command) return;

    if (command === "clear") {
        terminalOutput.replaceChildren();
        return;
    }

    if (command === "home") {
        window.location.href = "../index.html";
        return;
    }

    if (command === "cd ..") {
        window.location.href = isProjectPage ? "index.html" : "../index.html";
        return;
    }

    if (command === "projects" || command === "ls projects/") {
        addCommand(rawCommand, showProjects);
        return;
    }

    if (command === "cat readme.md") {
        if (isProjectPage) {
            addCommand(rawCommand, showProjectDetails);
        } else {
            addCommand(rawCommand, (block) => addMessage(block, "Choose a project with ls projects/."));
        }
        return;
    }

    if (command === "help") {
        addCommand(rawCommand, (block) => addMessage(block, "Commands: ls projects/, cat README.md, cd .., home, clear, help"));
        return;
    }

    addCommand(rawCommand, (block) => addMessage(block, `Command not found: ${rawCommand}`));
}

commandInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const command = commandInput.value;
    commandInput.value = "";
    runCommand(command);
});

runCommand(isProjectPage ? "cat README.md" : "ls projects/");

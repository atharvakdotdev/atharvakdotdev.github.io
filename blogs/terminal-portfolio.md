# A Portfolio You Can Explore Like a Terminal

This portfolio uses a terminal as its main interface. Instead of presenting projects as a row of static cards, it lets visitors move through the site with familiar directory commands and keeps the interface in one consistent visual language.

## Projects come from GitHub

The project list is fetched from GitHub's public repository API. The portfolio keeps repositories owned by the account, excludes forks, and features repositories with a topic containing the word `project`. That makes the GitHub topic the publishing switch: add or remove the topic to curate the list without editing the portfolio.

The list is cached in the browser for one minute to reduce requests. No access token is stored in the page, so this approach is limited to public repositories.

## Directories become navigation

The root `ls` command shows the site's main sections. Running `cd projects/` opens the project list, and `cd <repository-name>/` opens a repository detail view. Repository details use GitHub metadata and the repository's README, rendered as Markdown and sanitized before display.

The same quick terminal is available from each section. On desktop it sits beside the main terminal; on mobile it opens as a drawer so the content keeps its space.

## One interface, real destinations

The terminal is a navigation layer, not just decoration: its links point to the same destinations as its commands, and the browser URL records the selected repository so a detail view can be shared directly.

The result is a small site that behaves like one connected workspace while keeping its content backed by the places where it already lives: GitHub for projects, and individual pages for skills, videos, and posts.
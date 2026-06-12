# EZ AutoRefresh

EZ AutoRefresh is a lightweight and reliable Chrome extension that automatically refreshes web pages at fixed or random intervals.

Designed for monitoring dashboards, ticket systems, status pages, reports, and other frequently updated websites, EZ AutoRefresh provides an easy-to-use interface with task management and countdown monitoring.

## Features

* Fixed interval auto refresh
* Random interval auto refresh
* Multiple tab refresh tasks
* Real-time countdown display
* Edit running tasks without restarting
* Stop individual tasks or all tasks
* Automatic task recovery after browser restart
* Chrome Manifest V3 compatible
* Lightweight and privacy-friendly

## Installation

### From Chrome Web Store

Install EZ AutoRefresh directly from the Chrome Web Store.

### Manual Installation

1. Download or clone this repository.

2. Open Chrome and navigate to:

   chrome://extensions/

3. Enable **Developer Mode**.

4. Click **Load unpacked**.

5. Select the project folder.

## Usage

### Start Auto Refresh

1. Open the webpage you want to refresh.
2. Click the EZ AutoRefresh extension icon.
3. Choose one of the following modes:

* Fixed Time
* Random Time Range

4. Configure the refresh interval.
5. Click **Start Refresh for Current Page**.

### Manage Tasks

The task panel displays:

* Current running tasks
* Remaining countdown
* Next refresh time
* Refresh mode and interval

You can:

* Edit task settings
* Stop a single task
* Stop all tasks

## Permissions

This extension requires the following Chrome permissions:

### tabs

Used to refresh browser tabs.

### alarms

Used to schedule refresh tasks.

### storage

Used to save task configurations and restore them after browser restart.

## Privacy

EZ AutoRefresh does not collect, store, transmit, or share any personal information.

All task data is stored locally using Chrome Storage API.

No user data is sent to external servers.

For details, see the Privacy Policy.

## License

MIT License

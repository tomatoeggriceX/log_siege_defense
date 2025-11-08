// --- Required Node.js modules (matching your index.js) ---
const fs = require('fs-extra'); // Use fs-extra
const csv = require('fast-csv'); // Use fast-csv for writing
const { format } = require('date-fns'); // Use date-fns for formatting
const path = require('path');

// --- Plugin Definition ---
module.exports = {
  /**
   * Default configuration for the plugin.
   */
  defaultConfig: {
    enabled: true,
    // Filename for the exported CSV
    outputFilename: 'guild_defense_logs.csv',
    // Append new logs (true) or overwrite the file every time (false)
    appendLogs: true
  },

  /**
   * Details for the plugin configuration UI.
   */
  defaultConfigDetails: {
    outputFilename: {
      type: 'string',
      label: 'Output Filename'
    },
    appendLogs: {
      type: 'boolean',
      label: 'Append new logs (recommended)'
    }
  },

  pluginName: 'Guild Defense Log Exporter',
  pluginDescription: 'Parses Guild Siege battle logs and saves all personal defense logs to a CSV file.',
  temp: {}, // Added to match the example's structure

  /**
   * The main initialization function for the plugin.
   * @param {object} proxy The proxy instance.
   * @param {object} config The user's configuration for this plugin.
   */
  init: function(proxy, config) {
    const self = this; // Store context for nested functions

    // Use the 'apiCommand' event, as seen in your index.js
    proxy.on('apiCommand', (req, resp) => {
      // Use the config access method from your index.js
      if (config.Config.Plugins[self.pluginName].enabled) {
        
          // Check for the specific command and log_type
          if (req.command === 'GetGuildSiegeBattleLog' && req.log_type === 2) {
            // Log to proxy that we caught the packet
            proxy.log({
              type: 'info',
              source: 'plugin',
              name: self.pluginName,
              message: `Detected GetGuildSiegeBattleLog (log_type 2) response.`
            });
            
            // Pass to the log processor
            self.logDefenseLogs(proxy, req, resp, config, self);
          }
      }
      // Removed the stray bracket and comments that were here
    });
  },

  /**
   * Helper function to process the defense log data.
   */
  logDefenseLogs(proxy, req, resp, config, self) {
    if (!resp.battle_log_list || resp.battle_log_list.length === 0) {
      proxy.log({
        type: 'info',
        source: 'plugin',
        name: self.pluginName,
        message: 'Received siege logs, but no battle log entries were found.'
      });
      return;
    }

    const wizardID = req.wizard_id;
    let newLogEntries = [];

    // Loop through every log entry
    for (const log of resp.battle_log_list) {
      // We only want to save DEFENSE logs (type 2 or 4)
      if (log.log_type === 2 || log.log_type === 4) {
        
        let result = 'Draw/Other';
        if (log.win_lose === 1) result = 'Win';
        if (log.win_lose === 2) result = 'Loss';

        // Create an entry object
        newLogEntries.push({
          'Wizard Name': log.wizard_name || 'N/A',
          'Opponent Wizard': log.opp_wizard_name || 'N/A',
          // Use date-fns for formatting, just like the example
          'Siege Date': format(new Date(log.log_timestamp * 1000), 'yyyy-MM-dd'),
          'Opponent Guild': log.opp_guild_name || 'N/A',
          'Result': result,
          // Stringify the deck info
          'Deck Info': log.view_battle_deck_info ? JSON.stringify(log.view_battle_deck_info) : '{}'
        });
      }
    }

    if (newLogEntries.length > 0) {
      // Pass to the CSV writer function
      self.writeToCSV(proxy, wizardID, newLogEntries, config, self);
    } else {
      proxy.log({
        type: 'info',
        source: 'plugin',
        name: self.pluginName,
        message: 'Received siege logs, but found no new *defense* logs to save.'
      });
    }
  },

  /**
   * Helper function to write entries to a CSV file.
   * Modeled after your index.js example.
   */
  writeToCSV(proxy, wizardID, entries, config, self) {
    // Get plugin-specific config
    const pluginConfig = config.Config.Plugins[self.pluginName];
    const filename = pluginConfig.outputFilename;
    const appendLogs = pluginConfig.appendLogs;

    // Get file path from the *correct* config location
    const filepath = path.join(config.Config.App.filesPath, filename);
    const headers = [
      'Wizard Name',
      'Opponent Wizard',
      'Siege Date',
      'Opponent Guild',
      'Result',
      'Deck Info'
    ];
    
    let csvData = [];

    // Removed the final try...catch block
    if (!appendLogs || !fs.existsSync(filepath)) {
      // Overwrite or new file: Write headers + new entries
      csvData = entries;
      csv.writeToPath(filepath, csvData, { headers, writeHeaders: true })
        .on('finish', () => { // Corrected syntax error here
          proxy.log({
            type: 'success',
            source: 'plugin',
            name: self.pluginName,
            message: `(Over)wrote ${entries.length} defense logs to ${filename}`
          });
        })
        .on('error', (error) => {
          proxy.log({ type: 'error', source: 'plugin', name: self.pluginName, message: `Error writing new file: ${error.message}` });
        });
    } else {
      // Append mode: Read existing file first
      csv.parseFile(filepath, { ignoreEmpty: true, headers, renameHeaders: true })
        .on('data', (data) => {
          csvData.push(data); // Add existing row
        })
        .on('end', () => {
          csvData.push(...entries); // Add all new entries
          
          csv.writeToPath(filepath, csvData, { headers, writeHeaders: true })
            .on('finish', () => {
              proxy.log({
                type: 'success',
                source: 'plugin',
                name: self.pluginName,
                message: `Appended ${entries.length} new defense logs to ${filename}`
              });
            })
            .on('error', (error) => {
              proxy.log({ type: 'error', source: 'plugin', name: self.pluginName, message: `Error appending to file: ${error.message}` });
            });
        })
        .on('error', (error) => {
          // This happens if the file is empty or headers don't match
          // We'll just overwrite it
          proxy.log({ type: 'warn', source: 'plugin', name: self.pluginName, message: `Could not parse existing file, overwriting: ${error.message}` });
          
          csvData = entries; // Use new entries only
          csv.writeToPath(filepath, csvData, { headers, writeHeaders: true })
            .on('finish', () => proxy.log({ type: 'success', source: 'plugin', name: self.pluginName, message: `(Over)wrote ${entries.length} defense logs to ${filename}` }))
            .on('error', (err) => proxy.log({ type: 'error', source: 'plugin', name: self.pluginName, message: `Error overwriting file: ${err.message}` }));
        });
    }
  }
};
// --- Required Node.js modules (matching your index.js) ---
const fs = require('fs-extra'); // Use fs-extra
const csv = require('fast-csv'); // Use fast-csv for writing
const { format } = require('date-fns'); // Use date-fns for formatting
const path = require('path');
const { type } = require('os');

// --- Plugin Definition ---
module.exports = {
  /**
   * Default configuration for the plugin.
   */
  defaultConfig: {
    enabled: true,
    // Filename for the exported CSV
    outputFilename: 'guild_defense_logs.json'
  },

  /**
   * Details for the plugin configuration UI.
   */
  defaultConfigDetails: {
    outputFilename: {
      type: 'string',
      label: 'Output Filename'
    }
  },

  pluginName: 'Guild Defense Log Exporter',
  pluginDescription: 'Parses Guild Siege battle logs and saves all personal defense logs to a JSON file.',
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
    if (!resp['log_list'][0].battle_log_list || resp['log_list'][0].battle_log_list.length === 0) {
      proxy.log({
        type: 'info',
        source: 'plugin',
        name: self.pluginName,
        message: resp.battle_log_list.length
      });
      return;
    }

    const wizardID = req.wizard_id;
    let newLogEntries = [];
    
    // Loop through every log entry
    for (const log of resp['log_list'][0].battle_log_list) {
      // We only want to save DEFENSE logs (type 2 or 4)
      if (log.log_type === 2 || log.log_type === 4) {
        
        let result = 'Draw/Other';
        if (log.win_lose === 1) result = 'Win';
        if (log.win_lose === 2) result = 'Loss';
        // decode the battle deck info
        const decoded_deck = [];
        for (const unit_id of log.view_battle_deck_info['1']) {
          let unit;
          try {
            unit = gMapping.getMonsterName(unit_id);
          } catch {
            unit = unit_id;
          }
          decoded_deck.push(unit);
        }
        // Create an entry object
        newLogEntries.push({
          'Wizard Name': log.wizard_name || 'N/A',
          'Opponent Wizard': log.opp_wizard_name || 'N/A',
          // Use date-fns for formatting, just like the example
          'Siege Date': format(new Date(log.log_timestamp * 1000), 'yyyy-MM-dd'),
          'Defending Guild': log.guild_name || 'N/A',
          'Attacking Guild': log.opp_guild_name || 'N/A',
          'Result': result,
          // Stringify the deck info
          'Deck Info': decoded_deck.sort(),
          // get timestamp to check duplicates
          //'Timestamp' : format(new Date(log.log_timestamp * 1000), 'yyyy-MM-dd')
          'Timestamp':log.log_timestamp
        });
      }
    }

    if (newLogEntries.length > 0) {
      // Pass to the CSV writer function
      self.saveDefenseLogsToFile(proxy, wizardID, newLogEntries, config, self);
    } else {
      proxy.log({
        type: 'info',
        source: 'plugin',
        name: self.pluginName,
        message: 'Received siege logs, but found no new *defense* logs to save.'
      });
    }
  },


  // Helper function to read existing logs and dedupe
  // merge_defense_logs(entries, filepath) {
  //   const data = fs.readFileSync(filepath, 'utf8');
  //   existingLogs = JSON.parse(data);
  //   comb_data = existingLogs.concat(entries);
  //   // dedupe arrays
  //   const uniqueStrings = new Set(comb_data.map(obj => JSON.stringify(obj)));
  //   const deduplicatedArray = Array.from(uniqueStrings).map(str => JSON.parse(str));
  //   return deduplicatedArray;
  // },


  /**
   * Helper function to write entries to a json file.
   */
  saveDefenseLogsToFile(proxy, wizardID, entries, config, self) {
    // Get plugin-specific config
    const pluginConfig = config.Config.Plugins[self.pluginName];
    const filename = pluginConfig.outputFilename;

    // Get file path from the *correct* config location
    const filepath = path.join(config.Config.App.filesPath, filename);
    const headers = [
      'Wizard Name',
      'Opponent Wizard',
      'Siege Date',
      'Defending Guild',
      'Attacking Guild',
      'Result',
      'Deck Info',
      'Timestamp'
    ];
    
    try {
      // if exists, merge and dedupe
      // otherwise, just use original
      if (fs.existsSync(filepath)) {
        const data = fs.readFileSync(filepath, 'utf8');
        existingLogs = JSON.parse(data);
        comb_data = existingLogs.concat(entries);
        // dedupe arrays
        const uniqueStrings = new Set(comb_data.map(obj => JSON.stringify(obj)));
        deduped_array = Array.from(uniqueStrings).map(str => JSON.parse(str));
      }
      else{
        deduped_array = entries
      }
      // Convert to formatted JSON
      const jsonData = JSON.stringify(deduped_array, null, 2);

      // Write file to json
      fs.writeFileSync(filepath, jsonData, 'utf8');
      proxy.log({
        type: 'info',
        source: 'plugin',
        name: self.pluginName,
        message: `✅ Saved ${deduped_array.length} defense logs to ${filepath}`
      });

    } catch (error) {
      proxy.log({
        type: 'info',
        source: 'plugin',
        name: self.pluginName,
        message: `❌ Failed to save defense logs to json: ${error}`
      });
    }
    // Save to csv as well
    try
    {
      const csv = [
        headers.join(","), // header row
        ...deduped_array.map(row =>
          headers
            .map(header => {
              // Convert to string and escape quotes
              const cell = String(row[header] ?? "").replace(/"/g, '""');
              // Wrap in quotes to handle commas or special chars
              return `"${cell}"`;
            })
            .join(",")
        )
      ].join("\n");
      fs.writeFileSync(path.join(config.Config.App.filesPath, 'guild_defense_logs.csv'), csv, "utf8");
      proxy.log({
        type: 'info',
        source: 'plugin',
        name: self.pluginName,
        message: `✅ Saved ${deduped_array.length} defense logs to ${path.join(config.Config.App.filesPath, 'guild_defense_logs.csv')}`
      });
    }
    catch (error){
        proxy.log({
        type: 'info',
        source: 'plugin',
        name: self.pluginName,
        message: `❌ Failed to save defense logs to csv: ${error}`
        });
    }
  }
};    
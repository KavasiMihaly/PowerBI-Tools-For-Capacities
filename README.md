# Modifications by Mihaly Kavasi
This is an updated version of the Power BI Realistic Load testing tool.
Code is not complete. This version will not work by itself.

# Version 0.7.1
* Added enhanced UI design elements to testing interface including:
  - Professional header with "Realistic User Testing Tool Enhanced" title
  - Styled border with shadow effect around Power BI report embed
  - Matching footer with version information and developer credits
  - Modern color scheme (dark blue/light blue theme)
* Improved page layout and spacing for better readability
* Fixed footer text to properly credit both original Microsoft project and current maintainer
* Enhanced measurement accuracy by adjusting think time calculations in refresh duration metrics
* Added proper version numbering consistency across all interface elements
* Maintained full backwards compatibility with existing test configurations
![](../doc_images/Enhancements.png)
  
# Version 0.7
- Added the ability to define the Project Name for the test
- Created Test folder name is changed to Workspace Name + Report Name + DateTime from just DateTime
- Output file name is also modified to Workspace Name + Report Name + DateTime
- Selected bookmarks are now displaying correctly
- Added the ability to use a Page and Bookmarks files to setup the Test
- Added a Parameter Catalogue folder to store the filter for each report
- Added a Test Results folder to store the output (files are not yet saved there, need to be manually moved.)
- Changed the demo files to new ones representing the current state
- Added Output analysis file. (Need to be repointed once downloaded, before use)

# Version 0.6
- Added to ability to provide a filter file (example file added) during setup that will be added to the PowerBIReport file as filter parameters, so you do not need to go into the folders and manually modify each file
- Outputs the displayed values in a txt
- Additional files needed to work
- Added a randomly generated instance id to differentiate between browser session.
- Displaying current run time, current refresh time, page name, filters and slicers applied

# Version 0.5
- Created Test folder name is changed to Report Name + DateTime from just DateTime
- Added the ability to set the number of views (page refreshes) you want per window during setup
- Added the ability to set the think time during setup
- Added placeholders for Page Name and Bookmark in the PowerBIReport file template

# Original Readme below:

# Welcome To the Power BI Premium and Embedded Tools and Utilities Repository

This repository is meant to host tools and utilities designed to improve all aspects of Power BI capacity managment and lifecycle.

# Available Tools (as of July 2019)

[Load Testing Tool](http://aka.ms/PowerBILoadTestingTool).

# Contributing

This project welcomes contributions and suggestions.  Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit https://cla.opensource.microsoft.com.

When you submit a pull request, a CLA bot will automatically determine whether you need to provide
a CLA and decorate the PR appropriately (e.g., status check, comment). Simply follow the instructions
provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

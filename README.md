# An election night result tracker for NZ

My wife decided to host an election night party for the 2023 NZ General Election. She asked me to create a spreadsheet to track the winner of the 'guess the result' game. I didn't want to do manual data entry throuhgout or at the end of the night. And I ended up following that line of thinking too far and wrote this code which:

* Scrapes the results from the [office Electoral Commission results website](https://electionresults.govt.nz/) (I am despearately hoping they don't change the layout of the site on election night).
* Calls race winners (just like you see on the news coverage)
* Saves results to a Google sheet.

It also can send webhooks to configured URLs when:

1. There is an updated vote count for an electorate
1. There is a new leader in an electorate
1. There is a predicted winner in an electorate

I use these webhooks to announce over all of our Google Home speakers when there is a new leader or a predicted winner and I also change the colour of smart bulbs around the house to the colour associated with the leading party.

The Google sheet feeds an interactive public [Looker Studio report](https://lookerstudio.google.com/reporting/9d225597-c59a-4dee-bcf1-aaa50f40f13c) which so far shows:

* The number of parliamentary seats won by each party
* The results in each electorate
* The party vote in each electorate
* The 'cut line' for list MPs
* 'Flipped' electoral seats

...but I still haven't done her spreadsheet which helps her 'guess the result' game.